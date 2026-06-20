import { emitCacheEvent } from "./smart-cache-events";
import { readEntry, writeEntry } from "./smart-cache-store";
import type {
  TCacheStatus,
  TSmartCacheEntry,
  TSmartCacheReadOptions,
  TSmartCacheResult,
} from "./smart-cache.types";

const CACHE_VERSION = 1;

/** In-memory registry so concurrent callers share a single network refresh. */
const pendingRefreshes = new Map<string, Promise<unknown>>();

function fullKey(namespace: string, key: string): string {
  return `${namespace}::${key}`;
}

export function computeCacheStatus(entry: Pick<TSmartCacheEntry<unknown>, "updatedAt" | "ttlMs">, now = Date.now()): TCacheStatus {
  if (!Number.isFinite(entry.ttlMs)) {
    return "fresh";
  }

  const age = now - new Date(entry.updatedAt).getTime();

  if (age < entry.ttlMs) {
    return "fresh";
  }

  if (age < entry.ttlMs * 8) {
    return "stale";
  }

  return "expired";
}

function buildEntry<TData>(namespace: string, key: string, data: TData, ttlMs: number, previous?: TSmartCacheEntry<TData>): TSmartCacheEntry<TData> {
  const now = new Date().toISOString();
  return {
    key,
    data,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
    expiresAt: Number.isFinite(ttlMs) ? new Date(Date.now() + ttlMs).toISOString() : undefined,
    source: "network",
    status: "fresh",
    refreshState: "success",
    lastRefreshStartedAt: previous?.lastRefreshStartedAt,
    lastRefreshFinishedAt: now,
    lastRefreshError: undefined,
    ttlMs,
    version: CACHE_VERSION,
  };
}

/**
 * Start (or join) a deduplicated background refresh for a cache key. Resolves
 * with the fresh data; on failure the old cache entry is preserved and the
 * error is recorded in metadata.
 */
export function refreshCache<TData>(options: { namespace: string; key: string; ttlMs: number; resource?: string; fetcher: () => Promise<TData> }): Promise<TData> {
  const id = fullKey(options.namespace, options.key);
  const existing = pendingRefreshes.get(id);

  if (existing) {
    return existing as Promise<TData>;
  }

  const resource = options.resource ?? options.namespace;
  emitCacheEvent({ type: "cache-refresh-started", key: options.key, resource });

  const promise = (async (): Promise<TData> => {
    try {
      const data = await options.fetcher();
      const previous = await readEntry<TData>(options.namespace, options.key);
      const entry = buildEntry(options.namespace, options.key, data, options.ttlMs, previous);
      await writeEntry(options.namespace, options.key, entry);
      emitCacheEvent({ type: "cache-refresh-success", key: options.key, resource, updatedAt: entry.updatedAt });
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const previous = await readEntry<TData>(options.namespace, options.key);
      if (previous) {
        previous.refreshState = "failed";
        previous.lastRefreshFinishedAt = new Date().toISOString();
        previous.lastRefreshError = message;
        await writeEntry(options.namespace, options.key, previous).catch(() => undefined);
      }
      emitCacheEvent({ type: "cache-refresh-failed", key: options.key, resource, error: message });
      throw error;
    } finally {
      pendingRefreshes.delete(id);
    }
  })();

  pendingRefreshes.set(id, promise);
  return promise;
}

/**
 * Smart cache read: returns cached data immediately under stale-while-revalidate
 * (the default) and refreshes in the background, or follows the requested mode.
 */
export async function smartRead<TData>(options: TSmartCacheReadOptions<TData>): Promise<TSmartCacheResult<TData>> {
  const mode = options.mode ?? "stale-while-revalidate";
  const entry = await readEntry<TData>(options.namespace, options.key);
  const status = entry ? computeCacheStatus(entry) : "missing";

  const networkOnce = async (): Promise<TSmartCacheResult<TData>> => {
    const data = await refreshCache({ namespace: options.namespace, key: options.key, ttlMs: options.ttlMs, resource: options.namespace, fetcher: options.fetcher });
    return { data, fromCache: false, cacheStatus: "fresh", isRefreshing: false, updatedAt: new Date().toISOString() };
  };

  if (mode === "network-only") {
    return networkOnce();
  }

  if (mode === "cache-only") {
    if (!entry) {
      throw new Error(`No cached data for ${options.namespace}::${options.key}`);
    }
    return { data: entry.data, fromCache: true, cacheStatus: status === "missing" ? "expired" : status, isRefreshing: false, updatedAt: entry.updatedAt };
  }

  if (mode === "network-first") {
    try {
      return await networkOnce();
    } catch (error) {
      if (entry) {
        return { data: entry.data, fromCache: true, cacheStatus: status === "missing" ? "expired" : status, isRefreshing: false, updatedAt: entry.updatedAt };
      }
      throw error;
    }
  }

  if (mode === "cache-first") {
    if (entry) {
      return { data: entry.data, fromCache: true, cacheStatus: status === "missing" ? "expired" : status, isRefreshing: false, updatedAt: entry.updatedAt };
    }
    return networkOnce();
  }

  // stale-while-revalidate (default)
  if (!entry) {
    return networkOnce();
  }

  const shouldRevalidate = options.revalidateWhenFresh !== false || status !== "fresh";
  let refreshPromise: Promise<TData> | undefined;

  if (shouldRevalidate) {
    refreshPromise = refreshCache({ namespace: options.namespace, key: options.key, ttlMs: options.ttlMs, resource: options.namespace, fetcher: options.fetcher });
    // Avoid an unhandled rejection if the caller never awaits it.
    refreshPromise.catch(() => undefined);
  }

  return {
    data: entry.data,
    fromCache: true,
    cacheStatus: status === "missing" ? "expired" : status,
    isRefreshing: Boolean(refreshPromise),
    updatedAt: entry.updatedAt,
    refreshPromise,
  };
}

export function isRefreshPending(namespace: string, key: string): boolean {
  return pendingRefreshes.has(fullKey(namespace, key));
}
