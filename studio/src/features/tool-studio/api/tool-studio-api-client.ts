export type TConnectivityTestStep = {
  key: string;
  label: string;
  status: "success" | "failed" | "skipped";
  detail?: string;
};

export type TConnectivityTestResult = {
  success: boolean;
  steps: TConnectivityTestStep[];
  error?: string;
};

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

function get<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET" });
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}

export type TCfAppOpResult = { ok: boolean; logs?: string; output?: string; error?: string };

export type TXsuaaCandidate = {
  type: "oauth-client-credentials";
  label: string;
  serviceName: string;
  servicePlan?: string;
  url: string;
  apiUrl?: string;
  identityZone?: string;
};

export type TBtpServiceCredential = {
  id: string;
  name: string;
  region: string;
  org: string;
  space: string;
  app?: string;
  serviceName: string;
  servicePlan?: string;
  clientId: string;
  url: string;
  apiUrl?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  tags?: string[];
};

export type TQueueCreationResult = { queueName: string; ok: boolean; error?: string };

export type TCpiQueueFileResult = {
  serviceKeyFileName: string;
  namespace?: string;
  ok: boolean;
  error?: string;
  queues?: TQueueCreationResult[];
};

async function uploadRawFile<T>(path: string, file: File): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "x-file-name": file.name },
    body: await file.arrayBuffer(),
  });
  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & { error?: string }) : ({} as T & { error?: string });
  if (!response.ok) throw new ApiError(json?.error ?? `HTTP ${response.status}`);
  return json;
}

export type TJiraIssueSummary = {
  key: string;
  summary: string;
  status: string;
  assignee?: string;
  subtasks: Array<{ key: string; summary: string; status: string }>;
};

export type TIncidentSearchResult = Record<string, unknown> & { jira_ticket?: string; content?: string; similarity?: number };

export type TGitLabGroup = { id: number; name: string; full_path: string; visibility?: string };

export type TObjectTypeMode = "eventmesh" | "eventmesh_v1.6+" | "multiple_erp" | "multiple_erp_central" | "buma" | "SAP_SF" | "natrol_ecc" | "custom";
export type TCdsVersion = "cds6" | "cds7" | "cds8";

export type TDeployTarget = {
  id: string;
  name: string;
  gitlabBaseUrl: string;
  gitlabGroupId: number;
  gitlabGroupPath: string;
  defaultBranch: string;
  /** `region::org::space` — links this deploy target to a live CF space, so Check API External can cross-reference discovered srv repos against a real `cf apps` listing. */
  cfTargetKey?: string;
  objectTypeMode: TObjectTypeMode;
  cdsVersionDefault: TCdsVersion;
  isConsolidationDefault: boolean;
  ticketCodes: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type TObjectTypeRepoRef = { projectId: number; pathWithNamespace: string; role: "db" | "srv" | "srv_process" | "unknown"; defaultBranch: string };
export type TDiscoveredObjectType = { slug: string; envObjectName: string; repos: TObjectTypeRepoRef[]; source: "laidonBuild" | "manual" };

export type TGitLabUserSummary = { id: number; username: string; name: string };

export type TCdsServiceInfo = { name: string; path: string; sourceFile: string };
export type TResolvedAppServices = {
  matched: boolean;
  pathWithNamespace?: string;
  defaultBranch?: string;
  services: TCdsServiceInfo[];
  scanError?: string;
  /** `"live-index"` when discovered directly from the app's own root index (no GitLab involved); `"gitlab"` when that wasn't available and the fallback source-scan was used instead. */
  source?: "live-index" | "gitlab";
  fromCache?: boolean;
  updatedAt?: string;
  error?: string;
};

export type TODataProperty = { name: string; type: string; nullable: boolean };
export type TODataNavigationProperty = { name: string };
export type TODataEntityType = { name: string; keys: string[]; properties: TODataProperty[]; navigationProperties: TODataNavigationProperty[] };
export type TODataEntitySet = { name: string; entityTypeName: string };
export type TODataFunctionParameter = { name: string; type: string; nullable: boolean };
export type TODataFunctionImport = { name: string; httpMethod: string; parameters: TODataFunctionParameter[] };
export type TODataServiceMetadata = {
  version: "v2" | "v4";
  entitySets: TODataEntitySet[];
  entityTypes: Record<string, TODataEntityType>;
  functionImports: TODataFunctionImport[];
  error?: string;
};

export type TDeployModelResult = {
  entityName: string;
  mergeRequests: Array<{ role: string; pathWithNamespace: string; webUrl: string; iid: number }>;
  noChange: Array<{ role: string; pathWithNamespace: string; sourceBranch: string; targetBranch: string }>;
  skipped: Array<{ role: string; pathWithNamespace: string; reason: string }>;
  renamedEntities: TEntityRenameRisk[];
};

/** Mirrors `TEntityRenameRisk` in `csn-model-types.ts` — an entity's display label changed since this object type's last deploy while its technical EDMX name stayed the same, a real data-loss risk (see the type's own doc comment). */
export type TEntityRenameRisk = { technicalName: string; oldLabel: string; newLabel: string };

/** Mirrors `TJoinFieldRisk` in `csn-model-types.ts` — early-warning findings for structural anomalies in the uploaded EDMX/CSN. */
export type TJoinFieldRisk = {
  relationName: string;
  parentBusinessTable: string;
  targetBusinessTable: string;
  parentKeyField: string;
  severity: "critical" | "high" | "medium" | "info";
  outcome: "dropped-no-suggestion" | "dropped-with-label-suggestion" | "label-mismatch" | "resolved-by-override" | "non-standard-relation-name" | "composition-cycle" | "dangling-target";
  message: string;
};

/** Mirrors `TDeployDiffLine`/`TDeployFileDiff`/`TDeployRepoPreview`/`TDeployPreviewResult` in `deploy-model-job.ts`. */
export type TDeployDiffLine = { type: "add" | "remove" | "context" | "collapsed"; text?: string; count?: number };
export type TDeployFileDiff = { filePath: string; changeType: "create" | "update" | "no-change"; additions: number; deletions: number; lines: TDeployDiffLine[] };
export type TDeployRepoPreview = { role: string; pathWithNamespace: string; files: TDeployFileDiff[] };
export type TDeployPreviewResult = { entityName: string; cdsDkVersion?: string; repos: TDeployRepoPreview[]; renamedEntities?: TEntityRenameRisk[]; error?: string };

export const toolStudioApi = {
  getGitlabAuthStatus: () => get<{ isLoggedIn: boolean; username?: string; name?: string; baseUrl?: string; expiresAt?: string | null }>("/api/tool/gitlab/auth-status"),
  loginGitlab: (baseUrl: string, token: string) =>
    post<{ username?: string; name?: string; baseUrl?: string; expiresAt?: string | null; error?: string }>("/api/tool/gitlab/login", { baseUrl, token }),
  logoutGitlab: () => post<{ ok: boolean }>("/api/tool/gitlab/logout"),

  testSharePoint: (body: { tenantId: string; clientId: string; clientSecret: string; siteId: string; driveName?: string; folderPath?: string }) =>
    post<TConnectivityTestResult>("/api/tool/test-config/sharepoint", body),
  testAzureBlob: (body: { connectionString: string; containerName: string }) =>
    post<TConnectivityTestResult>("/api/tool/test-config/azure-blob", body),
  testS3: (body: { accessKeyId: string; secretAccessKey: string; region: string; bucketName: string; endpoint?: string }) =>
    post<TConnectivityTestResult>("/api/tool/test-config/s3", body),
  testSmtp: (body: { host: string; port: number; secure: boolean; username?: string; password?: string; from: string; to: string }) =>
    post<TConnectivityTestResult>("/api/tool/test-config/smtp", body),
  testOAuth2Email: (body: { tenantId: string; clientId: string; clientSecret: string; userFrom: string; userTo: string }) =>
    post<TConnectivityTestResult>("/api/tool/test-config/oauth2-email", body),

  getCfLogRestartDefaults: () => get<{ appNames: string[] }>("/api/tool/cf-log-restart/defaults"),
  getRecentLogs: (targetKey: string, appNames: string[]) =>
    post<{ results?: Record<string, TCfAppOpResult>; error?: string }>("/api/tool/cf-log-restart/logs", { targetKey, appNames }),
  restartApps: (targetKey: string, appNames: string[]) =>
    post<{ results?: Record<string, TCfAppOpResult>; error?: string }>("/api/tool/cf-log-restart/restart", { targetKey, appNames }),

  getXsuaaCandidates: (targetKey: string, appName: string) =>
    get<{ candidates: TXsuaaCandidate[]; error?: string }>(`/api/btp/xsuaa-candidates?targetKey=${encodeURIComponent(targetKey)}&appName=${encodeURIComponent(appName)}`),
  listBtpCredentials: () => get<{ credentials: TBtpServiceCredential[] }>("/api/tool/btp/credentials"),
  getBtpCredentialSuggestion: (cfTargetKey: string) =>
    get<{ credential?: TBtpServiceCredential }>(`/api/tool/btp/credentials/suggestion?cfTargetKey=${encodeURIComponent(cfTargetKey)}`),
  saveBtpCredential: (input: { targetKey: string; appName: string; serviceName: string; name?: string }) =>
    post<{ credential?: TBtpServiceCredential; error?: string }>("/api/tool/btp/credentials/save", input),
  removeBtpCredential: (id: string) => post<{ removed: boolean }>("/api/tool/btp/credentials/remove", { id }),

  getAppServices: (input: { cfTargetKey: string; appName: string; credentialId?: string; baseUrl?: string; refresh?: boolean }) =>
    get<TResolvedAppServices>(
      `/api/tool/check-api/app-services?cfTargetKey=${encodeURIComponent(input.cfTargetKey)}&appName=${encodeURIComponent(input.appName)}` +
        `${input.credentialId ? `&credentialId=${encodeURIComponent(input.credentialId)}` : ""}${input.baseUrl ? `&baseUrl=${encodeURIComponent(input.baseUrl)}` : ""}${input.refresh ? "&refresh=true" : ""}`,
    ),
  getCheckApiMetadata: (credentialId: string, baseUrl: string, path: string) =>
    get<TODataServiceMetadata>(`/api/tool/check-api/metadata?credentialId=${encodeURIComponent(credentialId)}&baseUrl=${encodeURIComponent(baseUrl)}&path=${encodeURIComponent(path)}`),
  callCheckApi: (input: {
    credentialId: string;
    baseUrl: string;
    path: string;
    method?: string;
    queryParams?: Record<string, string>;
    body?: unknown;
  }) => post<{ status: number; ok: boolean; body: unknown; url: string; error?: string }>("/api/tool/check-api/call", input),

  uploadCpiQueueZip: (file: File) => uploadRawFile<{ results: TCpiQueueFileResult[]; error?: string }>("/api/tool/cpi-queue/upload-and-create", file),

  getJiraDeployInfo: (input: { baseUrl: string; email: string; apiToken: string; issueKey: string }) =>
    post<{ source?: TJiraIssueSummary; referenced?: TJiraIssueSummary[]; error?: string }>("/api/tool/jira/deploy-info", input),
  postJiraWorkLog: (input: { baseUrl: string; email: string; apiToken: string; issueKey: string; started: string; timeSpentSeconds: number; comment?: string }) =>
    post<{ ok: boolean; error?: string }>("/api/tool/jira/worklog", input),

  searchIncidents: (input: { supabaseUrl: string; supabaseKey: string; ollamaUrl: string; query: string; matchCount?: number; matchThreshold?: number }) =>
    post<{ results: TIncidentSearchResult[]; error?: string }>("/api/tool/incident/search", input),

  getGitlabGroups: (refresh = false) => get<{ groups: TGitLabGroup[]; gitlabBaseUrl?: string; error?: string }>(`/api/tool/gitlab/groups${refresh ? "?refresh=true" : ""}`),
  listDeployTargets: () => get<{ targets: TDeployTarget[] }>("/api/tool/deploy-targets"),
  saveDeployTarget: (draft: Partial<TDeployTarget> & { name: string; gitlabGroupId: number; gitlabGroupPath: string; gitlabBaseUrl: string }) =>
    post<{ target?: TDeployTarget; error?: string }>("/api/tool/deploy-targets/save", draft),
  removeDeployTarget: (id: string) => post<{ removed: boolean }>("/api/tool/deploy-targets/remove", { id }),

  getObjectTypesForTarget: (deployTargetId: string, refresh = false) =>
    get<{ objectTypes: TDiscoveredObjectType[]; error?: string }>(`/api/tool/deploy-model/object-types?deployTargetId=${encodeURIComponent(deployTargetId)}${refresh ? "&refresh=true" : ""}`),
  getObjectTypeDefaults: (projectId: number, branch: string) =>
    get<{ cdsVersion?: TCdsVersion; isConsolidation?: boolean; error?: string }>(`/api/tool/deploy-model/object-type-defaults?projectId=${projectId}&branch=${encodeURIComponent(branch)}`),
  searchGitlabMembers: (projectId: number, query: string) =>
    get<{ members: TGitLabUserSummary[]; error?: string }>(`/api/tool/deploy-model/members?projectId=${projectId}&query=${encodeURIComponent(query)}`),

  uploadEdmx: (file: File) => uploadRawFile<{ uploadId: string; fileName: string; error?: string }>("/api/tool/deploy-model/upload", file),
  previewEdmxImport: (uploadId: string, objectType?: string, objectTypeMode?: TObjectTypeMode, repos?: TObjectTypeRepoRef[]) =>
    post<{ csn?: unknown; entityName?: string; joinRisks?: TJoinFieldRisk[]; joinRiskError?: string; cdsDkVersion?: string; renamedEntities?: TEntityRenameRisk[]; error?: string }>("/api/tool/deploy-model/preview", { uploadId, objectType, objectTypeMode, repos }),
  startDeployModelJob: (input: { uploadId: string; deployTargetId: string; objectTypeSlug: string; ticketCode?: string; assigneeId?: number; reviewerIds?: number[] }) =>
    post<{ jobId?: string; error?: string }>("/api/tool/deploy-model/deploy", input),
  previewDeployModelChanges: (input: { uploadId: string; deployTargetId: string; objectTypeSlug: string }) =>
    post<TDeployPreviewResult>("/api/tool/deploy-model/preview-changes", input),
  addManualObjectType: (input: { deployTargetId: string; slug: string; envObjectName?: string; projectId: number; pathWithNamespace: string; role: string; defaultBranch?: string }) =>
    post<{ ok?: boolean; error?: string }>("/api/tool/deploy-model/manual-object-type", input),
  removeManualObjectType: (deployTargetId: string, slug: string) =>
    post<{ ok?: boolean; error?: string }>("/api/tool/deploy-model/manual-object-type/remove", { deployTargetId, slug }),

  resolveNpmrcPackageId: (groupId: number, groupPath: string) =>
    get<{ packageId?: string; source?: string; candidateProjects?: Array<{ id: number; name: string; path_with_namespace: string }>; error?: string }>(
      `/api/tool/npmrc/resolve?groupId=${groupId}&groupPath=${encodeURIComponent(groupPath)}`,
    ),
  pinNpmrcPackageId: (groupId: number, groupPath: string, packageId: string) => post<{ ok: boolean }>("/api/tool/npmrc/pin", { groupId, groupPath, packageId }),
  unpinNpmrcPackageId: (groupId: number, groupPath: string) => post<{ ok: boolean }>("/api/tool/npmrc/unpin", { groupId, groupPath }),
};
