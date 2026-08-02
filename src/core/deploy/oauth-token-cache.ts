type TCachedToken = { token: string; expiresAt: number };

export type TOAuthTokenFetchResult = { token: string; expiresInSeconds?: number };

const tokenCache = new Map<string, TCachedToken>();
const pendingFetches = new Map<string, Promise<string>>();

/** Refresh this long before the real expiry so a call that starts right at the edge never races it. */
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

/** Used when the token endpoint didn't report `expires_in` at all. */
const DEFAULT_TOKEN_TTL_SECONDS = 600;

/**
 * Shared in-memory cache for client-credentials OAuth2 tokens (XSUAA, Destination service, Event
 * Mesh). The Studio backend is one long-lived process, so a token fetched seconds ago by one
 * action is still valid for the next — before this, every one of these three call sites requested
 * a brand-new token unconditionally on every call, which is what made "Try it out" and "Send
 * Event" feel slow. `fetchToken` only runs on a cache miss/expiry, and concurrent callers for the
 * same key share one in-flight request instead of firing a duplicate token POST each.
 */
export async function getCachedOAuthToken(key: string, fetchToken: () => Promise<TOAuthTokenFetchResult>): Promise<string> {
  const cached = tokenCache.get(key);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const pending = pendingFetches.get(key);

  if (pending) {
    return pending;
  }

  const fetchPromise = (async () => {
    try {
      const result = await fetchToken();
      const ttlMs = Math.max((result.expiresInSeconds ?? DEFAULT_TOKEN_TTL_SECONDS) * 1000 - EXPIRY_SAFETY_MARGIN_MS, 0);
      tokenCache.set(key, { token: result.token, expiresAt: Date.now() + ttlMs });
      return result.token;
    } finally {
      pendingFetches.delete(key);
    }
  })();

  pendingFetches.set(key, fetchPromise);
  return fetchPromise;
}

/** Drop a cached token — e.g. after the downstream API rejects it as invalid despite our TTL. */
export function clearCachedOAuthToken(key: string): void {
  tokenCache.delete(key);
}

/** Test-only: reset every cached token so re-running the same credential in a fresh test doesn't silently reuse a token cached by an earlier test/run. */
export function clearAllCachedOAuthTokens(): void {
  tokenCache.clear();
  pendingFetches.clear();
}
