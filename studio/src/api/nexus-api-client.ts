import type {
  TDiscoveredRepo,
  TNexusChangeImpactResult,
  TNexusChangeScopeInput,
  TNexusCodingAgent,
  TNexusContextResult,
  TNexusOverviewResponse,
  TNexusReadiness,
  TNexusRepoSummary,
  TNexusSearchResult,
  TNexusContract,
  TNexusSessionComparison,
  TNexusStatusPayload,
  TNexusWorkspaceImpactResult,
  TNexusWorkspaceSearchResult,
  TNexusWorkspaceStatus,
} from "./nexus-api-types";

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

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function scopeToBody(scope: TNexusChangeScopeInput): Record<string, unknown> {
  if (scope.kind === "commit") return { commit: scope.hash };
  if (scope.kind === "branch-diff") return { sourceBranch: scope.source, targetBranch: scope.target };
  if (scope.kind === "staged") return { staged: true };
  return {};
}

export const nexusApi = {
  getReadiness: (): Promise<TNexusReadiness> => get("/api/nexus/readiness"),

  listRepos: (): Promise<{ status?: string; message?: string; repos: TNexusRepoSummary[] }> => get("/api/nexus/repos"),

  discoverRepos: (folder: string): Promise<{ repos: TDiscoveredRepo[] }> => post("/api/nexus/discover", { folder }),

  /** Opens a native OS folder-picker dialog on the machine this server is running on (always the
   * user's own machine — see native-folder-picker.ts's doc). Resolves once the user picks a
   * folder or cancels; there's no timeout. */
  pickFolder: (initialPath?: string): Promise<{ path?: string; canceled: boolean; error?: string }> => post("/api/nexus/pick-folder", { initialPath }),

  analyzeRepo: (repoPath: string, options?: { name?: string; force?: boolean; fullContext?: boolean }): Promise<TNexusStatusPayload & { output?: string }> =>
    post("/api/nexus/analyze", { repoPath, ...options }),

  removeRepo: (nameOrPath: string): Promise<TNexusStatusPayload> => post(`/api/nexus/${encodeURIComponent(nameOrPath)}/remove`),

  getOverview: (repoPath: string): Promise<TNexusOverviewResponse> => get(`/api/nexus/overview${qs({ repo: repoPath })}`),

  search: (repoPath: string, query: string): Promise<TNexusSearchResult> => get(`/api/nexus/search${qs({ repo: repoPath, q: query })}`),

  trace: (repoPath: string, symbol: string, file?: string): Promise<TNexusContextResult> => get(`/api/nexus/trace${qs({ repo: repoPath, symbol, file })}`),

  analyzeChangeImpact: (repoPath: string, scope: TNexusChangeScopeInput): Promise<TNexusChangeImpactResult> => post("/api/nexus/changes", { repo: repoPath, ...scopeToBody(scope) }),

  analyzeSymbolImpact: (repoPath: string, symbol: string): Promise<TNexusChangeImpactResult> => post("/api/nexus/symbol-impact", { repo: repoPath, symbol }),

  listWorkspaces: (): Promise<{ names: string[] } & TNexusStatusPayload> => get("/api/nexus/workspaces"),

  createWorkspace: (name: string): Promise<TNexusStatusPayload> => post("/api/nexus/workspaces", { name }),

  addRepoToWorkspace: (workspace: string, groupPath: string, registryName: string): Promise<TNexusStatusPayload> =>
    post(`/api/nexus/workspaces/${encodeURIComponent(workspace)}/members`, { groupPath, registryName }),

  removeRepoFromWorkspace: (workspace: string, groupPath: string): Promise<TNexusStatusPayload> =>
    post(`/api/nexus/workspaces/${encodeURIComponent(workspace)}/members/remove`, { groupPath }),

  syncWorkspace: (workspace: string): Promise<TNexusStatusPayload> => post(`/api/nexus/workspaces/${encodeURIComponent(workspace)}/sync`),

  getWorkspaceImpact: (workspace: string, groupPath: string, target: string): Promise<TNexusWorkspaceImpactResult> =>
    post(`/api/nexus/workspaces/${encodeURIComponent(workspace)}/impact`, { groupPath, target }),

  searchWorkspaceFlows: (workspace: string, query: string): Promise<TNexusWorkspaceSearchResult> =>
    get(`/api/nexus/workspaces/${encodeURIComponent(workspace)}/search${qs({ q: query })}`),

  getWorkspaceContracts: (workspace: string): Promise<{ contracts: TNexusContract[] } & TNexusStatusPayload> =>
    get(`/api/nexus/workspaces/${encodeURIComponent(workspace)}/contracts`),

  openAdvancedGraphView: (): Promise<TNexusStatusPayload & { url?: string }> => post("/api/nexus/advanced/graph-view"),

  getWorkspaceStatus: (workspace: string): Promise<TNexusWorkspaceStatus> => get(`/api/nexus/workspaces/${encodeURIComponent(workspace)}`),

  configureAgent: (agent: TNexusCodingAgent, options?: { remove?: boolean; repoPath?: string }): Promise<TNexusStatusPayload> =>
    post("/api/nexus/configure", { agent, ...options }),

  getSessionComparison: (sessionId: string): Promise<TNexusSessionComparison> => get(`/api/nexus/session-comparison${qs({ sessionId })}`),

  getEnhancedContinuationPrompt: (sessionId: string): Promise<{ prompt: string; codeIntelligenceAvailable: boolean }> =>
    get(`/api/nexus/continuation-prompt${qs({ sessionId })}`),

  openFile: (repoPath: string, filePath: string, line?: number): Promise<{ ok: boolean; error?: string }> => post("/api/nexus/open-file", { repoPath, filePath, line }),

  openInVsCode: (repoPath: string): Promise<{ ok: boolean; error?: string }> => post("/api/nexus/open-vscode", { repoPath }),
};
