import { getResolvedConnection, touchConnectionUsage } from "./db-cache";
import { HanaAdapter } from "./db-hana-adapter";
import { PostgresAdapter } from "./db-postgres-adapter";
import { classifyDatabaseError } from "./db-error";
import type {
  IDatabaseAdapter,
  TConnectionTestResult,
  TDatabaseErrorInfo,
  TResolvedDatabaseConnection,
} from "./db-types";

export function createAdapter(
  connection: TResolvedDatabaseConnection,
  options?: { queryTimeoutMs?: number },
): IDatabaseAdapter {
  switch (connection.type) {
    case "hana":
      return new HanaAdapter(connection, options);
    case "postgresql":
      return new PostgresAdapter(connection, options);
    default:
      throw new Error(`Unsupported database type: ${String(connection.type)}`);
  }
}

export async function testConnectionProfile(
  connection: TResolvedDatabaseConnection,
  options?: { queryTimeoutMs?: number },
): Promise<TConnectionTestResult> {
  const adapter = createAdapter(connection, options);

  try {
    await adapter.connect();
    return await adapter.testConnection();
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
      durationMs: 0,
    };
  } finally {
    await adapter.disconnect();
  }
}

export type TStudioConnectionStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "reconnecting"
  | "failed";

export type TStudioConnectionState = {
  adapter: IDatabaseAdapter;
  connectionId: string;
  status: TStudioConnectionStatus;
  lastUsedAt: string;
  lastError?: TDatabaseErrorInfo;
};

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Keeps one live adapter per connection id, tracks its lifecycle state, and
 * transparently recovers from dropped sockets. Read-only operations can be
 * retried once after an automatic reconnect; destructive SQL is never retried.
 */
export class StudioConnectionPool {
  private readonly states = new Map<string, TStudioConnectionState>();

  constructor(private readonly options?: { queryTimeoutMs?: number }) {}

  private classify(adapter: IDatabaseAdapter, error: unknown): TDatabaseErrorInfo {
    return adapter.classifyError ? adapter.classifyError(error) : classifyDatabaseError(error, adapter.type);
  }

  private async reconnectAdapter(adapter: IDatabaseAdapter): Promise<void> {
    if (adapter.reconnect) {
      await adapter.reconnect();
      return;
    }
    await adapter.disconnect().catch(() => undefined);
    await adapter.connect();
  }

  /** Ensure a connected adapter + state record exists for the connection. */
  private async ensureState(connectionId: string): Promise<TStudioConnectionState> {
    const existing = this.states.get(connectionId);
    if (existing) {
      return existing;
    }

    const resolved = await getResolvedConnection(connectionId);
    const adapter = createAdapter(resolved, this.options);
    const state: TStudioConnectionState = {
      adapter,
      connectionId,
      status: "connecting",
      lastUsedAt: new Date().toISOString(),
    };
    this.states.set(connectionId, state);

    try {
      await adapter.connect();
      state.status = "connected";
      await touchConnectionUsage(connectionId).catch(() => undefined);
    } catch (error) {
      state.status = "failed";
      state.lastError = this.classify(adapter, error);
      this.states.delete(connectionId);
      throw error;
    }

    return state;
  }

  public async getAdapter(connectionId: string): Promise<IDatabaseAdapter> {
    const state = await this.ensureState(connectionId);
    state.lastUsedAt = new Date().toISOString();
    return state.adapter;
  }

  /**
   * Run an action against the connection's adapter. When
   * `retryReadOnlyOnNetworkError` is set and the action fails with a transient
   * network/timeout error, the adapter is reconnected and the action retried
   * exactly once. Only pass that option for read-only work.
   */
  public async runWithAdapter<T>(
    connectionId: string,
    action: (adapter: IDatabaseAdapter) => Promise<T>,
    options?: { retryReadOnlyOnNetworkError?: boolean },
  ): Promise<T> {
    const state = await this.ensureState(connectionId);
    state.lastUsedAt = new Date().toISOString();

    try {
      const result = await action(state.adapter);
      state.status = "connected";
      state.lastError = undefined;
      return result;
    } catch (error) {
      const info = this.classify(state.adapter, error);
      state.lastError = info;

      if (options?.retryReadOnlyOnNetworkError && info.retryable) {
        state.status = "reconnecting";
        try {
          await this.reconnectAdapter(state.adapter);
          const result = await action(state.adapter);
          state.status = "connected";
          state.lastError = undefined;
          await touchConnectionUsage(connectionId).catch(() => undefined);
          return result;
        } catch (retryError) {
          state.status = "failed";
          state.lastError = this.classify(state.adapter, retryError);
          throw retryError;
        }
      }

      // Mark transient failures as disconnected (recoverable) vs hard failed.
      state.status = info.kind === "network" || info.kind === "timeout" ? "disconnected" : "failed";
      throw error;
    }
  }

  public async testConnection(connectionId: string): Promise<TConnectionTestResult> {
    const state = await this.ensureState(connectionId);
    const result = await state.adapter.testConnection();
    state.status = result.success ? "connected" : "failed";
    if (result.success) {
      state.lastError = undefined;
    }
    return result;
  }

  /** Force a reconnect and re-test. Used by the "Reconnect" recovery action. */
  public async reconnectConnection(connectionId: string): Promise<TConnectionTestResult> {
    const state = await this.ensureState(connectionId);
    state.status = "reconnecting";
    try {
      await this.reconnectAdapter(state.adapter);
      const result = await state.adapter.testConnection();
      state.status = result.success ? "connected" : "failed";
      if (result.success) state.lastError = undefined;
      return result;
    } catch (error) {
      state.status = "failed";
      state.lastError = this.classify(state.adapter, error);
      return {
        success: false,
        message: state.lastError.message,
        durationMs: 0,
      };
    }
  }

  /** Drop a cached adapter entirely (e.g. after credentials were refreshed). */
  public async invalidateConnection(connectionId: string): Promise<void> {
    const state = this.states.get(connectionId);
    if (state) {
      this.states.delete(connectionId);
      await state.adapter.disconnect().catch(() => undefined);
    }
  }

  public async closeConnection(connectionId: string): Promise<void> {
    await this.invalidateConnection(connectionId);
  }

  public async closeIdleConnections(): Promise<void> {
    const now = Date.now();
    const idle = [...this.states.values()].filter(
      (state) => now - new Date(state.lastUsedAt).getTime() > IDLE_TIMEOUT_MS,
    );
    for (const state of idle) {
      await this.invalidateConnection(state.connectionId);
    }
  }

  public getConnectionStatus(connectionId: string): TStudioConnectionState | undefined {
    return this.states.get(connectionId);
  }

  public listConnectionStatuses(): Array<{
    connectionId: string;
    status: TStudioConnectionStatus;
    lastUsedAt: string;
    lastError?: TDatabaseErrorInfo;
  }> {
    return [...this.states.values()].map((state) => ({
      connectionId: state.connectionId,
      status: state.status,
      lastUsedAt: state.lastUsedAt,
      lastError: state.lastError,
    }));
  }

  public async closeAll(): Promise<void> {
    const states = [...this.states.values()];
    this.states.clear();
    await Promise.all(states.map((state) => state.adapter.disconnect().catch(() => undefined)));
  }
}
