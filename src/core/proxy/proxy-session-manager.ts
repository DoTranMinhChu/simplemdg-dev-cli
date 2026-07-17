import type { TCapturedSession, TProxyUserCredential, TResolvedProxyEnvironment } from "./proxy-types";
import { captureProxySession, type TProxyCaptureCallbacks } from "./proxy-capture";
import { computeCacheStatus, readEntry, refreshCache } from "../cache/smart-cache";

const PROXY_SESSIONS_NAMESPACE = "proxy-sessions";

function getSessionTtlMs(): number {
  const fromEnvironment = Number(process.env.SMDG_PROXY_SESSION_REUSE_MAX_AGE_MS);
  return Number.isFinite(fromEnvironment) && fromEnvironment > 0 ? fromEnvironment : 20 * 60 * 1000;
}

type TSessionEntry = {
  session: TCapturedSession;
  env: TResolvedProxyEnvironment;
  user: TProxyUserCredential;
  callbacks: TProxyCaptureCallbacks;
  refreshTimer?: NodeJS.Timeout;
};

/**
 * Owns every running environment's live session for THIS process, plus its proactive
 * refresh timer. Both `smdg proxy start <env>` (one entry) and `smdg proxy studio` (many
 * entries concurrently) share this same module. Session capture/reuse itself is delegated
 * to the CLI's existing smart-cache (`src/core/cache/smart-cache.ts` — the same
 * stale-while-revalidate mechanism `cf apps`/`gitlab groups` use), namespace
 * `"proxy-sessions"`, so `smdg cache status/clear/refresh proxy` works for free and a
 * fresh session is de-duplicated across concurrent callers by `refreshCache` itself
 * (no bespoke refresh-lock needed here).
 */
const sessions = new Map<string, TSessionEntry>();

const PROACTIVE_REFRESH_INTERVAL_MS = Number(process.env.SMDG_PROXY_REFRESH_INTERVAL_MS) || 25 * 60 * 1000;

export function getActiveSession(envId: string): TCapturedSession | null {
  return sessions.get(envId)?.session ?? null;
}

export function isEnvRunning(envId: string): boolean {
  return sessions.has(envId);
}

export function listRunningEnvIds(): string[] {
  return Array.from(sessions.keys());
}

export function getRunningEnvInfo(envId: string): { capturedAt: string; userID: string } | null {
  const entry = sessions.get(envId);
  if (!entry) return null;
  return { capturedAt: entry.session.capturedAt, userID: entry.user.userID };
}

function scheduleProactiveRefresh(envId: string): void {
  const entry = sessions.get(envId);
  if (!entry) return;

  if (entry.refreshTimer) {
    clearInterval(entry.refreshTimer);
  }

  const timer = setInterval(() => {
    void refreshSession(envId, `Proactive session refresh (${Math.round(PROACTIVE_REFRESH_INTERVAL_MS / 60000)} min schedule)`);
  }, PROACTIVE_REFRESH_INTERVAL_MS);
  timer.unref();
  entry.refreshTimer = timer;
}

async function captureFreshSession(
  env: TResolvedProxyEnvironment,
  user: TProxyUserCredential,
  callbacks: TProxyCaptureCallbacks,
): Promise<TCapturedSession> {
  return refreshCache({
    namespace: PROXY_SESSIONS_NAMESPACE,
    key: env.id,
    ttlMs: getSessionTtlMs(),
    fetcher: () => captureProxySession(env, user, callbacks),
  });
}

/** Captures (or reuses a still-fresh cached) session and starts tracking it for refresh. */
export async function ensureInitialSession(
  env: TResolvedProxyEnvironment,
  user: TProxyUserCredential,
  callbacks: TProxyCaptureCallbacks = {},
): Promise<TCapturedSession> {
  const cached = await readEntry<TCapturedSession>(PROXY_SESSIONS_NAMESPACE, env.id);
  const status = cached ? computeCacheStatus(cached) : "missing";

  let session: TCapturedSession;
  if (cached && status === "fresh") {
    callbacks.onLog?.(`Reusing recent session captured at ${cached.data.capturedAt}.`);
    session = cached.data;
  } else {
    session = await captureFreshSession(env, user, callbacks);
  }

  sessions.set(env.id, { session, env, user, callbacks });
  scheduleProactiveRefresh(env.id);
  return session;
}

/** Reactive (401/403/expired) or proactive refresh. De-duplicated across concurrent callers by `refreshCache` itself. */
export async function refreshSession(
  envId: string,
  reason: string,
  callbacksOverride?: TProxyCaptureCallbacks,
): Promise<TCapturedSession | null> {
  const entry = sessions.get(envId);
  if (!entry) return null;

  const callbacks = callbacksOverride ?? entry.callbacks;
  callbacks.onLog?.(`Session refresh started. Reason: ${reason}`);

  try {
    const freshSession = await captureFreshSession(entry.env, entry.user, callbacks);
    entry.session = freshSession;
    callbacks.onLog?.(`Session refresh completed at ${freshSession.capturedAt}`);
    return freshSession;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    callbacks.onLog?.(`Session refresh failed: ${message}`);
    return null;
  }
}

export function stopSession(envId: string): void {
  const entry = sessions.get(envId);
  if (entry?.refreshTimer) {
    clearInterval(entry.refreshTimer);
  }
  sessions.delete(envId);
}
