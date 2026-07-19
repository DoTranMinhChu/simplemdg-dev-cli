// Core data model for Code Intelligence (GitNexus integration). Every status
// value here is plain-English product vocabulary translated from GitNexus's
// own raw output — see nexus-status.ts for the translation layer. Nothing in
// this file assumes GitNexus is running; `error`/`setup-required` are always
// valid values so a route/CLI command can degrade instead of crashing.

export type TNexusStatus = "ready" | "setup-required" | "index-required" | "update-required" | "analyzing" | "error";

export type TNexusReadiness = {
  status: TNexusStatus;
  message: string;
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
  /** GitNexus registry alias — the stable `-r <name>` key for all subsequent CLI calls. */
  name: string;
  path: string;
  status: TNexusStatus;
  message: string;
  branch?: string;
  indexedAt?: string;
  indexedCommit?: string;
  stats?: TNexusRepoStats;
};

export type TNexusWorkspaceMember = {
  groupPath: string;
  registryName: string;
};

export type TNexusWorkspaceSummary = {
  name: string;
  synced: boolean;
  members: Array<TNexusWorkspaceMember & { status: TNexusStatus; message: string }>;
};

export type TNexusRiskLevel = "low" | "medium" | "high" | "unknown";

export type TNexusChangedSymbol = {
  name: string;
  detail?: string;
};

export type TNexusChangeImpactResult = {
  scopeDescription: string;
  changed: boolean;
  fileCount: number;
  symbolCount: number;
  affectedProcessCount: number;
  risk: TNexusRiskLevel;
  riskReason: string;
  changedSymbols: TNexusChangedSymbol[];
  caveat?: string;
};

export type TNexusSymbolRef = {
  uid: string;
  name: string;
  kind?: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
};

export type TNexusContextResult = {
  found: boolean;
  symbol?: TNexusSymbolRef;
  callers: TNexusSymbolRef[];
  callees: TNexusSymbolRef[];
};

export type TNexusSearchMatch = {
  filePath: string;
  score: number;
  rank: number;
  symbolIds: string[];
};

export type TNexusSearchResult = {
  query: string;
  matches: TNexusSearchMatch[];
  /** Surfaces a GitNexus-reported degradation (e.g. "FTS indexes missing") — never silently dropped, since an empty result set for that reason looks identical to a genuine "no matches" otherwise. */
  warning?: string;
};
