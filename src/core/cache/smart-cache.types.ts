export type TCacheReadMode =
  | "cache-first"
  | "network-first"
  | "cache-only"
  | "network-only"
  | "stale-while-revalidate";

export type TCacheStatus = "fresh" | "stale" | "expired";

export type TRefreshState = "idle" | "refreshing" | "success" | "failed";

export type TSmartCacheEntry<TData> = {
  key: string;
  data: TData;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  source: "cache" | "network";
  status: TCacheStatus;
  refreshState?: TRefreshState;
  lastRefreshStartedAt?: string;
  lastRefreshFinishedAt?: string;
  lastRefreshError?: string;
  ttlMs: number;
  version: number;
};

export type TSmartCacheResult<TData> = {
  data: TData;
  fromCache: boolean;
  cacheStatus: TCacheStatus | "missing";
  isRefreshing: boolean;
  updatedAt?: string;
  refreshPromise?: Promise<TData>;
};

export type TSmartCacheReadOptions<TData> = {
  namespace: string;
  key: string;
  ttlMs: number;
  mode?: TCacheReadMode;
  fetcher: () => Promise<TData>;
  /** Revalidate in the background even when the cached entry is still fresh. */
  revalidateWhenFresh?: boolean;
};

export type TCacheEventType =
  | "cache-refresh-started"
  | "cache-refresh-success"
  | "cache-refresh-failed";

export type TCacheEvent = {
  type: TCacheEventType;
  key: string;
  resource: string;
  updatedAt?: string;
  error?: string;
  /** Optional per-region scan progress for cross-region target refreshes. */
  detail?: {
    region?: string;
    regionStatus?: "queued" | "scanning" | "success" | "failed";
    targetCount?: number;
    totalRegions?: number;
    completedRegions?: number;
    failedRegions?: number;
  };
};

export type TNamespaceStat = {
  namespace: string;
  count: number;
  lastUpdatedAt?: string;
  exists: boolean;
};

/** Default TTLs (ms). BTP/GitLab structures rarely change second-to-second. */
export const DEFAULT_CACHE_TTL = {
  cfRegions: 7 * 24 * 60 * 60 * 1000,
  cfOrgs: 6 * 60 * 60 * 1000,
  cfSpaces: 6 * 60 * 60 * 1000,
  cfApps: 10 * 60 * 1000,
  cfEnv: 5 * 60 * 1000,
  dbImportCandidates: 10 * 60 * 1000,
  gitlabGroups: 6 * 60 * 60 * 1000,
  gitlabProjects: 30 * 60 * 1000,
  gitlabBranches: 5 * 60 * 1000,
  objectTypeDiscovery: 60 * 60 * 1000,
  objectTypeSuggestions: 60 * 60 * 1000,
  srvAppServices: 60 * 60 * 1000,
  dbMetadata: 10 * 60 * 1000,
  dbConnections: Number.POSITIVE_INFINITY,
} as const;
