import type {
  TCfAuthStatus,
  TCfLoginRequest,
  TCfLoginResponse,
  TCfRegionEndpoint,
  TConnectionTestResult,
  TDatabaseColumn,
  TDatabaseIndex,
  TDatabaseErrorInfo,
  TDatabaseObject,
  TDatabaseObjectKind,
  TDatabasePrimaryKey,
  TDatabaseSchema,
  TDatabaseType,
  TRecoveryAction,
  TGetBtpAppsResponse,
  TGetBtpDbCandidatesResponse,
  TGetBtpTargetsResponse,
  TGridSortState,
  TPublicDatabaseConnection,
  TQueryHistoryItem,
  TRowDelete,
  TRowInsert,
  TRowUpdate,
  TRunQueryResponse,
  TSaveTableChangesResult,
  TSavedQuery,
  TStudioSettings,
  TStudioWorkspaceState,
  TTableDataResponse,
} from "./studio-api-types";

class ApiError extends Error {}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }

  if (!response.ok) {
    const message = (json as { error?: string })?.error ?? `HTTP ${response.status}`;
    throw new ApiError(message);
  }

  return json as T;
}

// De-duplicate identical in-flight GET requests (catalog/status/table lookups
// are idempotent) so re-rendering a component that fires the same fetch twice
// in a tick — or a user mashing Refresh — never doubles up backend load.
const inFlightGets = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  const existing = inFlightGets.get(path);
  if (existing) return existing as Promise<T>;

  const request = apiFetch<T>(path, { method: "GET" }).finally(() => {
    inFlightGets.delete(path);
  });
  inFlightGets.set(path, request);
  return request;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}

function put<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PUT", body: body !== undefined ? JSON.stringify(body) : undefined });
}

function del<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

// --- Connections --------------------------------------------------------------

export type TConnectionDraft = {
  name: string;
  type: TDatabaseType;
  host: string;
  port: number;
  database?: string;
  schema?: string;
  username: string;
  password: string;
  ssl?: boolean;
  sslValidateCertificate?: boolean;
  color?: string;
  environment?: string;
};

export const studioApi = {
  getConnections: () => get<{ connections: TPublicDatabaseConnection[] }>("/api/connections"),
  testConnection: (connectionId: string) => post<TConnectionTestResult>("/api/connections/test", { connectionId }),
  testDraftConnection: (draft: TConnectionDraft) => post<TConnectionTestResult>("/api/connections/test-draft", draft),
  createConnection: (draft: TConnectionDraft) => post<{ connection: TPublicDatabaseConnection }>("/api/connections/create", draft),
  renameConnection: (id: string, name: string) => post<{ id: string; name: string }>("/api/connections/rename", { id, name }),
  updateConnection: (id: string, patch: Partial<TConnectionDraft> & { isFavorite?: boolean; tags?: string[] }) =>
    post<{ connection: TPublicDatabaseConnection }>("/api/connections/update", { id, ...patch }),
  duplicateConnection: (id: string) => post<{ id: string; name: string }>("/api/connections/duplicate", { id }),
  removeConnection: (id: string) => post<{ removed: boolean }>("/api/connections/remove", { id }),
  importFromApp: (input: { app: string; serviceName?: string; type?: TDatabaseType; targetKey?: string }) =>
    post<{ connection: TPublicDatabaseConnection }>("/api/connections/import-from-app", input),
  reconnectConnection: (connectionId: string) =>
    post<TConnectionTestResult & { status?: string; errorInfo?: unknown }>("/api/connections/reconnect", { connectionId }),
  closeConnection: (connectionId: string) => post<{ ok: boolean }>("/api/connections/close", { connectionId }),
  getConnectionStatus: (connectionId: string) =>
    get<{ connectionId: string; status: string; lastUsedAt?: string; errorInfo?: unknown }>(`/api/connections/status${qs({ connectionId })}`),
  refreshCredentialsFromBtp: (connectionId: string) =>
    post<{ ok: boolean; connection?: TPublicDatabaseConnection; test?: TConnectionTestResult; error?: string }>(
      "/api/connections/refresh-from-btp",
      { connectionId },
    ),

  // --- CF auth ---
  getCfAuthStatus: () => get<TCfAuthStatus>("/api/cf/auth-status"),
  loginCf: (input: TCfLoginRequest) => post<TCfLoginResponse>("/api/cf/login", input),
  logoutCf: (clearCachedCredentials = false) => post<{ ok: boolean }>("/api/cf/logout", { clearCachedCredentials }),
  getCfRegions: () => get<{ regions: TCfRegionEndpoint[] }>("/api/cf/regions"),

  // --- BTP targets/apps/db-candidates ---
  getBtpTargets: () => get<TGetBtpTargetsResponse>("/api/btp/targets"),
  refreshBtpTargets: () => post<{ ok: boolean; started: boolean }>("/api/btp/targets/refresh"),
  getBtpApps: (targetKey: string, refresh = false) =>
    get<TGetBtpAppsResponse>(`/api/btp/apps${qs({ targetKey, refresh })}`),
  getBtpDbCandidates: (targetKey: string, appName: string, refresh = false) =>
    get<TGetBtpDbCandidatesResponse>(`/api/btp/db-candidates${qs({ targetKey, appName, refresh })}`),
  setBtpFavorite: (targetKey: string, add: boolean) => post<{ ok: boolean }>("/api/btp/favorite", { targetKey, add }),
  addBtpRecent: (targetKey: string) => post<{ ok: boolean }>("/api/btp/recent", { targetKey }),

  // --- Catalog ---
  getSchemas: (connectionId: string) =>
    get<{ schemas?: TDatabaseSchema[]; error?: string; errorInfo?: TDatabaseErrorInfo; recoveryActions?: TRecoveryAction[] }>(
      `/api/catalog/schemas${qs({ connectionId })}`,
    ),
  getObjects: (connectionId: string, schema: string, kinds?: TDatabaseObjectKind[], search?: string) =>
    get<{ objects?: TDatabaseObject[]; error?: string; errorInfo?: TDatabaseErrorInfo; recoveryActions?: TRecoveryAction[] }>(
      `/api/catalog/objects${qs({ connectionId, schema, kinds: kinds?.join(","), search })}`,
    ),
  getColumns: (connectionId: string, schema: string, table: string) =>
    get<{ columns?: TDatabaseColumn[]; indexes?: TDatabaseIndex[]; error?: string; errorInfo?: TDatabaseErrorInfo; recoveryActions?: TRecoveryAction[] }>(
      `/api/catalog/columns${qs({ connectionId, schema, table })}`,
    ),
  getDdl: (connectionId: string, schema: string, table: string) =>
    get<{ ddl: string }>(`/api/catalog/ddl${qs({ connectionId, schema, table })}`),
  getPrimaryKey: (connectionId: string, schema: string, table: string) =>
    get<{ primaryKey: TDatabasePrimaryKey }>(`/api/catalog/primary-key${qs({ connectionId, schema, table })}`),
  getConstraints: (connectionId: string, schema: string, table: string) =>
    get<{ primaryKey: TDatabasePrimaryKey; indexes: TDatabaseIndex[] }>(`/api/catalog/constraints${qs({ connectionId, schema, table })}`),

  // --- Table data ---
  getTableData: (input: { connectionId: string; schema: string; table: string; limit: number; offset: number; where?: string; orderBy?: string; orderDirection?: "asc" | "desc" }) =>
    post<TTableDataResponse>("/api/table/data", input),
  getTableCount: (connectionId: string, schema: string, table: string) =>
    post<{ count: number }>("/api/table/count", { connectionId, schema, table }),
  updateRow: (connectionId: string, schema: string, table: string, change: TRowUpdate, readOnly?: boolean) =>
    post<{ ok: boolean; result?: unknown; error?: string; blocked?: boolean }>("/api/table/row/update", { connectionId, schema, table, ...change, readOnly }),
  insertRow: (connectionId: string, schema: string, table: string, change: TRowInsert, readOnly?: boolean) =>
    post<{ ok: boolean; result?: unknown; error?: string; blocked?: boolean }>("/api/table/row/insert", { connectionId, schema, table, ...change, readOnly }),
  deleteRow: (connectionId: string, schema: string, table: string, change: TRowDelete, readOnly?: boolean) =>
    post<{ ok: boolean; result?: unknown; error?: string; blocked?: boolean }>("/api/table/row/delete", { connectionId, schema, table, ...change, readOnly }),
  saveTableChanges: (input: { connectionId: string; schema: string; table: string; primaryKeyColumns: string[]; updates: TRowUpdate[]; inserts: TRowInsert[]; deletes: TRowDelete[]; readOnly?: boolean }) =>
    post<{ ok: boolean; result?: TSaveTableChangesResult; blocked?: boolean; error?: string }>("/api/table/save-changes", input),
  generateTableSql: (connectionId: string, schema: string, table: string, limit: number) =>
    post<{ select: string; count: string }>("/api/table/sql", { connectionId, schema, table, limit }),
  generateFullTableSql: (connectionId: string, schema: string, table: string, limit: number) =>
    post<{ select: string; count: string; insert: string; update: string }>("/api/table/generate-sql", { connectionId, schema, table, limit }),
  generateTableQuery: (input: { connectionId: string; schema: string; table: string; where?: string; sort?: TGridSortState[]; limit: number; offset: number }) =>
    post<{ sql: string }>("/api/sql/generate-table-query", input),

  // --- SQL query ---
  runQuery: (input: { connectionId: string; sql: string; limit: number; readOnly: boolean; confirmDangerous?: boolean }) =>
    post<TRunQueryResponse>("/api/query/run", input),
  formatSql: (sql: string) => post<{ sql: string }>("/api/sql/format", { sql }),
  parseStatements: (sql: string) => post<{ statements: string[] }>("/api/sql/parse-statements", { sql }),

  // --- Saved queries + history ---
  getSavedQueries: () => get<{ queries: TSavedQuery[] }>("/api/queries"),
  saveQuery: (input: { name: string; sql: string; connectionId?: string; connectionType?: TDatabaseType; tags?: string[] }) =>
    post<{ query: TSavedQuery }>("/api/queries", input),
  updateSavedQuery: (id: string, input: { name: string; sql?: string; connectionId?: string }) =>
    put<{ query: TSavedQuery }>(`/api/queries/${encodeURIComponent(id)}`, input),
  deleteSavedQuery: (id: string) => del<{ deleted: boolean }>(`/api/queries/${encodeURIComponent(id)}`),
  getHistory: () => get<{ history: TQueryHistoryItem[] }>("/api/history"),
  clearHistory: () => del<{ cleared: boolean }>("/api/history"),

  // --- Workspace + settings ---
  getWorkspace: () => get<{ workspace: TStudioWorkspaceState | null }>("/api/studio/workspace"),
  saveWorkspace: (workspace: TStudioWorkspaceState) => put<{ workspace: TStudioWorkspaceState }>("/api/studio/workspace", workspace),
  getSettings: () => get<{ settings: TStudioSettings }>("/api/studio/settings"),
  saveSettings: (settings: Partial<TStudioSettings>) => put<{ settings: TStudioSettings }>("/api/studio/settings", settings),

  // --- Export (file downloads; not JSON) ---
  exportUrl: (kind: "csv" | "json") => `/api/export/${kind}`,
  exportDataUrl: () => "/api/export/data",
};

export { ApiError };
