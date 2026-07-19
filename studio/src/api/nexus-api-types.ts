// Hand-duplicated from src/core/nexus/nexus-types.ts (this app's own convention — studio has no
// direct import path into the CLI's TS project, see ai-studio-api-types.ts for precedent).

export type TNexusStatus = "ready" | "setup-required" | "index-required" | "update-required" | "analyzing" | "error";

/** Every Nexus API response may include these — a route degrades to HTTP 200 with a non-"ready"
 * status instead of throwing, so components must check this before trusting the rest of the payload. */
export type TNexusStatusPayload = {
  status?: TNexusStatus;
  message?: string;
};

export type TNexusReadiness = TNexusStatusPayload & {
  installed: boolean;
  version?: string;
};

export type TNexusRepoStats = {
  files: number;
  symbols: number;
  edges: number;
  clusters: number;
  processes: number;
};

export type TNexusRepoSummary = {
  name: string;
  path: string;
  status: TNexusStatus;
  message: string;
  branch?: string;
  indexedAt?: string;
  indexedCommit?: string;
  stats?: TNexusRepoStats;
};

export type TDiscoveredRepo = { path: string; name: string };

export type TNexusRiskLevel = "low" | "medium" | "high" | "unknown";

export type TNexusChangedSymbol = { name: string; detail?: string };

export type TNexusChangedFile = { status: string; path: string; oldPath?: string };

export type TNexusChangeImpactResult = TNexusStatusPayload & {
  scopeDescription: string;
  changed: boolean;
  fileCount: number;
  symbolCount: number;
  affectedProcessCount: number;
  risk: TNexusRiskLevel;
  riskReason: string;
  changedSymbols: TNexusChangedSymbol[];
  caveat?: string;
  changedFiles?: TNexusChangedFile[];
};

export type TNexusSymbolRef = {
  uid: string;
  name: string;
  kind?: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
};

export type TNexusContextResult = TNexusStatusPayload & {
  found: boolean;
  symbol?: TNexusSymbolRef;
  callers: TNexusSymbolRef[];
  callees: TNexusSymbolRef[];
};

export type TNexusSearchMatch = { filePath: string; score: number; rank: number; symbolIds: string[] };

export type TNexusSearchResult = TNexusStatusPayload & {
  query: string;
  matches: TNexusSearchMatch[];
  warning?: string;
};

export type TNexusImpactResult = TNexusStatusPayload & {
  found: boolean;
  target?: TNexusSymbolRef;
  risk: TNexusRiskLevel;
  riskReason: string;
  impactedCount: number;
  affectedProcesses: Array<{ name: string; filePath: string }>;
};

export type TNexusOverview = {
  branch?: string;
  indexedAt?: string;
  upToDate?: boolean;
  stats?: TNexusRepoStats;
};

export type TNexusOverviewResponse = TNexusStatusPayload & {
  repo?: TNexusRepoSummary;
  overview?: TNexusOverview;
};

export type TNexusWorkspaceMemberStatus = { groupPath: string; indexStatus: string; contractsStatus: string };
export type TNexusWorkspaceStatus = TNexusStatusPayload & {
  name: string;
  synced: boolean;
  members: TNexusWorkspaceMemberStatus[];
};

export type TNexusSessionComparison = TNexusStatusPayload & {
  repo?: TNexusRepoSummary;
  agentTouchedFiles: string[];
  gitNexusAffectedFiles: string[];
  missedFiles: string[];
  affectedProcessCount: number;
  risk: TNexusRiskLevel;
  summary: string;
};

export type TNexusWorkspaceImpactResult = TNexusStatusPayload & {
  risk: TNexusRiskLevel;
  directCount: number;
  processesAffected: number;
  modulesAffected: number;
  crossRepoHits: number;
  affectedProcesses: Array<{ name: string; filePath: string }>;
  crossRepoRaw: unknown[];
};

export type TNexusWorkspaceSearchResult = TNexusStatusPayload & {
  perRepo: Array<{ repo: string; count: number }>;
  resultsRaw: unknown[];
};

export type TNexusContract = { direction: string; key: string; repo: string; symbolName: string };

export type TNexusCodingAgent = "claude" | "codex" | "cursor" | "opencode" | "antigravity";

export type TNexusChangeScopeInput =
  | { kind: "uncommitted" }
  | { kind: "staged" }
  | { kind: "commit"; hash: string }
  | { kind: "branch-diff"; source: string; target: string };
