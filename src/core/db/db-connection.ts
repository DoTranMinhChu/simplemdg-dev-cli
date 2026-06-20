import { getResolvedConnection, touchConnectionUsage } from "./db-cache";
import { HanaAdapter } from "./db-hana-adapter";
import { PostgresAdapter } from "./db-postgres-adapter";
import type { IDatabaseAdapter, TConnectionTestResult, TResolvedDatabaseConnection } from "./db-types";

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

/**
 * Keeps one live adapter per connection id for the lifetime of a studio
 * session, so repeated queries against the same connection reuse a single
 * established session.
 */
export class StudioConnectionPool {
  private readonly adapters = new Map<string, IDatabaseAdapter>();

  constructor(private readonly options?: { queryTimeoutMs?: number }) {}

  public async getAdapter(connectionId: string): Promise<IDatabaseAdapter> {
    const existing = this.adapters.get(connectionId);

    if (existing) {
      return existing;
    }

    const resolved = await getResolvedConnection(connectionId);
    const adapter = createAdapter(resolved, this.options);
    await adapter.connect();
    this.adapters.set(connectionId, adapter);
    await touchConnectionUsage(connectionId).catch(() => undefined);
    return adapter;
  }

  public async closeConnection(connectionId: string): Promise<void> {
    const adapter = this.adapters.get(connectionId);

    if (adapter) {
      this.adapters.delete(connectionId);
      await adapter.disconnect().catch(() => undefined);
    }
  }

  public async closeAll(): Promise<void> {
    const adapters = [...this.adapters.values()];
    this.adapters.clear();
    await Promise.all(adapters.map((adapter) => adapter.disconnect().catch(() => undefined)));
  }
}
