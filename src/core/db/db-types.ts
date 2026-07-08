export type TDatabaseType = "hana" | "postgresql";

export type TConnectionEnvironment = "DEV" | "QAS" | "PROD" | "SANDBOX" | "CUSTOM";

export type TDatabaseConnectionProfile = {
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
  encryptedPassword: string;
  ssl?: boolean;
  sslValidateCertificate?: boolean;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  tags?: string[];
};

/**
 * A connection profile whose password has been decrypted for internal server
 * use. This shape never leaves the local process boundary.
 */
export type TResolvedDatabaseConnection = Omit<TDatabaseConnectionProfile, "encryptedPassword"> & {
  password: string;
};

/**
 * A connection profile safe to send to the browser: no password material.
 */
export type TPublicDatabaseConnection = Omit<TDatabaseConnectionProfile, "encryptedPassword">;

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

export type TDatabaseObjectKind =
  | "table"
  | "view"
  | "column-view"
  | "procedure"
  | "function"
  | "synonym"
  | "index";

export type TDatabaseObject = {
  schema: string;
  name: string;
  kind: TDatabaseObjectKind;
  type?: string;
  comment?: string;
};

export type TDatabaseSchema = {
  name: string;
  isSystem: boolean;
};

export type TDatabaseIndex = {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimaryKey: boolean;
};

export type TDatabaseQueryResult = {
  fields: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  affectedRows?: number;
  command?: string;
  durationMs: number;
  truncated?: boolean;
};

/**
 * A database service candidate detected inside a parsed VCAP_SERVICES block.
 * The password is kept here only transiently while importing from BTP.
 */
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
  password: string;
  ssl: boolean;
  sslValidateCertificate?: boolean;
};

export type TBtpAppDatabaseImportContext = {
  region?: string;
  org?: string;
  space?: string;
  app?: string;
};

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

export type TSqlSafetyAnalysis = {
  isDestructive: boolean;
  isReadOnly: boolean;
  blockedByReadOnly: boolean;
  matchedKeywords: string[];
  reason?: string;
};

export type TConnectionTestResult = {
  success: boolean;
  message: string;
  serverVersion?: string;
  durationMs: number;
};

export type TDatabaseErrorKind =
  | "network"
  | "authentication"
  | "permission"
  | "syntax"
  | "timeout"
  | "stale-credential"
  | "unknown";

export type TDatabaseErrorCode =
  | "DB_CONNECTION_FAILED"
  | "DB_SOCKET_CLOSED"
  | "DB_AUTH_FAILED"
  | "DB_PERMISSION_DENIED"
  | "DB_QUERY_FAILED"
  | "DB_TIMEOUT"
  | "DB_UNKNOWN_ERROR";

export type TDatabaseErrorInfo = {
  kind: TDatabaseErrorKind;
  code: TDatabaseErrorCode;
  message: string;
  originalMessage: string;
  retryable: boolean;
};

export type TListObjectsOptions = {
  schema?: string;
  kinds?: TDatabaseObjectKind[];
  search?: string;
};

export type TTableDataOptions = {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  where?: string;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

/**
 * Common interface implemented by every database adapter. Adapters own dialect
 * specifics (quoting, system catalog queries) so the rest of the studio is
 * dialect-agnostic.
 */
export type TDatabasePrimaryKey = {
  columns: string[];
  constraintName?: string;
};

export type TRowUpdate = {
  key: Record<string, unknown>;
  changes: Record<string, unknown>;
};

export type TRowInsert = {
  values: Record<string, unknown>;
};

export type TRowDelete = {
  key: Record<string, unknown>;
};

export type TTableChangeSet = {
  schema: string;
  table: string;
  primaryKeyColumns: string[];
  updates: TRowUpdate[];
  inserts: TRowInsert[];
  deletes: TRowDelete[];
};

export type TSaveRowResult = {
  type: "update" | "insert" | "delete";
  success: boolean;
  key?: Record<string, unknown>;
  error?: string;
};

export type TSaveTableChangesResult = {
  success: boolean;
  updated: number;
  inserted: number;
  deleted: number;
  rowResults: TSaveRowResult[];
};

export type TGridSortState = {
  column: string;
  direction: "asc" | "desc";
};

export type TStudioTabType = "welcome" | "sql" | "data-grid" | "metadata" | "query-file" | "history";

export type TStudioTabState = {
  id: string;
  type: TStudioTabType;
  title: string;
  groupId?: string;
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

export type TStudioTabGroup = {
  id: string;
  name: string;
  color: string;
  collapsed?: boolean;
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
  tabGroups: TStudioTabGroup[];
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

export interface IDatabaseAdapter {
  readonly type: TDatabaseType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(): Promise<TConnectionTestResult>;
  /** Lightweight liveness probe (e.g. SELECT 1). Returns false if the socket is dead. */
  isConnected?(): Promise<boolean>;
  /** Force a full disconnect + reconnect cycle. */
  reconnect?(): Promise<void>;
  /** Classify a thrown driver error into a stable, UI-friendly shape. */
  classifyError?(error: unknown): TDatabaseErrorInfo;
  getPrimaryKey(schema: string, table: string): Promise<TDatabasePrimaryKey>;
  runQuery(sql: string, options?: { maxRows?: number }): Promise<TDatabaseQueryResult>;
  /** Run a parameterized statement. Placeholders come from `placeholder()`. */
  runParameterized(sql: string, params: unknown[], options?: { maxRows?: number }): Promise<TDatabaseQueryResult>;
  /** Dialect-specific bind placeholder for parameter N (1-based). */
  placeholder(index: number): string;
  listSchemas(): Promise<TDatabaseSchema[]>;
  listObjects(options: TListObjectsOptions): Promise<TDatabaseObject[]>;
  listColumns(schema: string, table: string): Promise<TDatabaseColumn[]>;
  listIndexes(schema: string, table: string): Promise<TDatabaseIndex[]>;
  countRows(schema: string, table: string): Promise<number>;
  getTableData(options: TTableDataOptions): Promise<TDatabaseQueryResult>;
  quoteIdentifier(identifier: string): string;
  buildQualifiedName(schema: string, name: string): string;
}
