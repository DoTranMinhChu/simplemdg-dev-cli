/**
 * Hand-maintained mirror of the backend's browser-safe response shapes
 * (src/core/db/db-types.ts, src/core/cf/*). Keep in sync with the server —
 * these are the ONLY types the frontend ever sees. Secrets (passwords,
 * tokens) never appear here; the backend strips them before responding.
 */

export type TDatabaseType = "hana" | "postgresql";
export type TConnectionEnvironment = "DEV" | "QAS" | "PROD" | "SANDBOX" | "CUSTOM";

export type TPublicDatabaseConnection = {
  id: string;
  name: string;
  color?: string;
  environment?: TConnectionEnvironment;
  isFavorite?: boolean;
  type: TDatabaseType;
  region?: string;
  org?: string;
  space?: string;
  app?: string;
  serviceName?: string;
  servicePlan?: string;
  host: string;
  port: number;
  database?: string;
  schema?: string;
  username: string;
  ssl?: boolean;
  sslValidateCertificate?: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  tags?: string[];
};

export type TConnectionTestResult = {
  success: boolean;
  message: string;
  serverVersion?: string;
  durationMs: number;
};

export type TDatabaseErrorKind = "network" | "authentication" | "permission" | "syntax" | "timeout" | "stale-credential" | "unknown";

export type TDatabaseErrorCode = "DB_CONNECTION_FAILED" | "DB_SOCKET_CLOSED" | "DB_AUTH_FAILED" | "DB_PERMISSION_DENIED" | "DB_QUERY_FAILED" | "DB_TIMEOUT" | "DB_UNKNOWN_ERROR";

export type TRecoveryAction = "retry" | "reconnect" | "refresh-from-btp" | "close-connection";

export type TDatabaseErrorInfo = {
  kind: TDatabaseErrorKind;
  code: TDatabaseErrorCode;
  message: string;
  originalMessage: string;
  retryable: boolean;
};

export type TConnectionStatus = "connected" | "connecting" | "disconnected" | "reconnecting" | "failed";

export type TDatabaseSchema = { name: string; isSystem: boolean };

export type TDatabaseObjectKind = "table" | "view" | "column-view" | "procedure" | "function" | "synonym" | "index";

export type TDatabaseObject = {
  schema: string;
  name: string;
  kind: TDatabaseObjectKind;
  type?: string;
  comment?: string;
};

export type TDatabaseColumn = {
  name: string;
  dataType: string;
  length?: number;
  scale?: number;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey?: boolean;
  comment?: string;
  position?: number;
};

export type TDatabaseIndex = { name: string; columns: string[]; isUnique: boolean; isPrimaryKey: boolean };
export type TDatabasePrimaryKey = { columns: string[]; constraintName?: string };

export type TDatabaseQueryResult = {
  fields: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  affectedRows?: number;
  command?: string;
  durationMs: number;
  truncated?: boolean;
};

export type TSqlSafetyAnalysis = {
  isDestructive: boolean;
  isReadOnly: boolean;
  blockedByReadOnly: boolean;
  matchedKeywords: string[];
  reason?: string;
};

export type TRunQueryResponse =
  | { ok: true; result: TDatabaseQueryResult; safety: TSqlSafetyAnalysis; effectiveSql: string }
  | { ok: false; blocked: true; safety: TSqlSafetyAnalysis; error: string }
  | { ok: false; needsConfirmation: true; safety: TSqlSafetyAnalysis }
  | { ok: false; error: string };

export type TGridSortState = { column: string; direction: "asc" | "desc" };

export type TTableDataResponse =
  | { result: TDatabaseQueryResult; error?: undefined }
  | { error: string; errorInfo?: TDatabaseErrorInfo; recoveryActions?: TRecoveryAction[]; result?: undefined };

export type TRowUpdate = { key: Record<string, unknown>; changes: Record<string, unknown> };
export type TRowInsert = { values: Record<string, unknown> };
export type TRowDelete = { key: Record<string, unknown> };

export type TSaveRowResult = { type: "update" | "insert" | "delete"; success: boolean; key?: Record<string, unknown>; error?: string };
export type TSaveTableChangesResult = { success: boolean; updated: number; inserted: number; deleted: number; rowResults: TSaveRowResult[] };

export type TSavedQuery = {
  id: string;
  name: string;
  connectionType?: TDatabaseType;
  connectionId?: string;
  sql: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
};

export type TQueryHistoryItem = {
  id: string;
  timestamp: string;
  connectionId?: string;
  connectionName?: string;
  connectionType?: TDatabaseType;
  sql: string;
  durationMs: number;
  success: boolean;
  rowCount?: number;
  error?: string;
};

export type TStudioTabType = "welcome" | "sql" | "data-grid" | "metadata";

export type TStudioTabState = {
  id: string;
  type: TStudioTabType;
  title: string;
  pinned?: boolean;
  dirty?: boolean;
  connectionId?: string;
  schema?: string;
  objectName?: string;
  objectType?: "table" | "view";
  sql?: string;
  filter?: string;
  pageSize?: number;
  pageIndex?: number;
  sort?: TGridSortState[];
  openedAt: string;
  updatedAt: string;
};

export type TStudioLayoutState = {
  sidebarWidth?: number;
  readOnly?: boolean;
  sidebarCollapsed?: boolean;
  collapsedSidebarSections?: Record<string, boolean>;
  connectionGroupBy?: "favorite" | "environment" | "region" | "org" | "type";
};

export type TStudioWorkspaceState = {
  version: number;
  activeTabId?: string;
  tabs: TStudioTabState[];
  tabGroups: unknown[];
  layout: TStudioLayoutState;
  updatedAt: string;
};

export type TStudioSettings = {
  restoreWorkspace: boolean;
  defaultRowLimit: number;
  defaultSchema?: string;
  readOnlyByDefault: boolean;
  queryTimeoutMs: number;
  autoFormatGeneratedSql: boolean;
  autoSaveDelayMs: number;
  maxHistoryItems: number;
  showProductionWarning: boolean;
  theme: string;
};

// --- Cloud Foundry / BTP -----------------------------------------------------

export type TCfAuthStatus = {
  cfCliAvailable: boolean;
  hasCachedCredentials: boolean;
  isLoggedIn: boolean;
  cachedUsername?: string;
  lastLoginAt?: string;
  currentTarget?: { region?: string; apiEndpoint?: string; org?: string; space?: string };
  authMode: "cached-password" | "none";
  message?: string;
};

export type TCfLoginRequest = {
  apiEndpoint: string;
  region?: string;
  username: string;
  password: string;
  remember: boolean;
};

export type TCfLoginResponse = {
  success: boolean;
  username?: string;
  apiEndpoint?: string;
  region?: string;
  message?: string;
  error?: string;
};

export type TCfRegionEndpoint = { region: string; apiEndpoint: string; label?: string; enabled: boolean; isCustom?: boolean };

export type TCfEnvironmentTag = "DEV" | "QAS" | "PROD" | "SANDBOX" | "POC" | "UAT" | "STAGING" | "UNKNOWN";

export type TCfTargetSummary = {
  region: string;
  apiEndpoint: string;
  org: string;
  space: string;
  key: string;
  isFavorite: boolean;
  lastUsedAt?: string;
  environment?: string;
  cachedAppCount?: number;
  cacheStatus: "fresh" | "stale" | "expired" | "missing";
  updatedAt?: string;
  updatedAgo?: string;
};

export type TCfRegionStatus = {
  region: string;
  targetCount: number;
  noSpaceOrgCount?: number;
  failedSpaceOrgCount?: number;
  updatedAt: string;
  refreshState?: string;
  scanError?: string;
};

export type TGetBtpTargetsResponse = {
  favorites: TCfTargetSummary[];
  recent: TCfTargetSummary[];
  byRegion: Record<string, TCfTargetSummary[]>;
  noSpaceByRegion: Record<string, Array<{ org: string; status: string; error?: string }>>;
  totalTargets: number;
  regions: string[];
  regionStatus: TCfRegionStatus[];
  lastUpdatedAt?: string;
  lastUpdatedAgo?: string;
};

export type TCloudFoundryApp = { name: string; requestedState?: string; processes?: string; routes?: string };

export type TGetBtpAppsResponse = {
  targetKey: string;
  target?: { region: string; org: string; space: string };
  apps: TCloudFoundryApp[];
  cacheStatus: "fresh" | "stale" | "expired" | "missing";
  fromCache: boolean;
  isRefreshing: boolean;
  updatedAt?: string;
  updatedAgo?: string;
  warning?: string;
  error?: string;
};

export type TDatabaseServiceCandidate = {
  type: TDatabaseType;
  label: string;
  serviceName: string;
  servicePlan?: string;
  host: string;
  port: number;
  database?: string;
  schema?: string;
  username: string;
  ssl: boolean;
  sslValidateCertificate?: boolean;
};

export type TGetBtpDbCandidatesResponse = {
  targetKey: string;
  target?: { region: string; org: string; space: string };
  appName: string;
  candidates: TDatabaseServiceCandidate[];
  cacheStatus: "fresh" | "stale" | "expired" | "missing";
  fromCache: boolean;
  isRefreshing: boolean;
  updatedAt?: string;
  updatedAgo?: string;
  warning?: string;
  error?: string;
};

// --- Server-Sent Events ------------------------------------------------------

export type TCacheEventType = "cache-refresh-started" | "cache-refresh-success" | "cache-refresh-failed";

export type TCacheEvent = {
  type: TCacheEventType;
  key: string;
  resource: string;
  updatedAt?: string;
  error?: string;
  detail?: {
    region?: string;
    regionStatus?: "queued" | "scanning" | "success" | "failed";
    targetCount?: number;
    totalRegions?: number;
    completedRegions?: number;
    failedRegions?: number;
  };
};
