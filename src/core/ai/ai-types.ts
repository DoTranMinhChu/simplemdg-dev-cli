// Core data model for `smdg ai studio`. Every field here is either OBSERVED
// (parsed directly from a session file) or DERIVED deterministically from
// observed data (durations, counts, turn boundaries). Nothing in this file is
// an LLM inference — see ai-session-analysis.ts for the (clearly-labelled)
// interpretive layer built on top of it.

export type TAiProvider = "claude" | "codex" | "cursor" | "unknown";

export type TAiObservationType =
  | "user"
  | "assistant"
  | "reasoning"
  | "tool-call"
  | "shell-command"
  | "mcp-call"
  | "skill"
  | "subagent"
  | "command"
  | "error";

export type TAiObservation = {
  id: string;
  sessionId: string;
  idx: number;
  type: TAiObservationType;
  /** Tool/skill/subagent/command name; "user"/"assistant"/"reasoning" for those types. */
  name: string;
  startedAt: string;
  durationMs: number;
  input: string;
  output: string;
  tokens: number;
  /** True for subagent/sidechain transcript content spliced into the parent session. */
  sidechain: boolean;
  /** Id of the observation this one hangs off (parent/child chain); "" for a turn root. */
  parentId: string;
  /** True only when the tool result explicitly reported an error (is_error, non-zero exit, etc.). */
  isError: boolean;
  /** JSON blob of extra audit fields (e.g. { agentId } for a subagent spawn, exit codes). */
  metadata: string;
};

export type TAiSession = {
  id: string;
  provider: TAiProvider;

  project: string;
  cwd: string;

  title: string;
  model: string;

  gitBranch?: string;

  startedAt: string;
  endedAt: string;

  durationMs: number;

  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** Tokens spent writing new cache entries (Anthropic's `cache_creation_input_tokens`); already folded into `inputTokens` too — kept separate only so cache-reuse-rate can be computed. Always 0 for providers without a cache-write concept (Codex). */
  cacheCreationTokens: number;

  /** Best-effort estimate of how full the context window is *right now* — the most recent turn's
   *  total context size (its input + cache-read + cache-creation + output tokens for Claude; the
   *  provider's own live running total for Codex), NOT a sum across every turn. `inputTokens` /
   *  `outputTokens` above are a lifetime spend total (they grow every turn and routinely exceed
   *  `contextWindowTokens` in a long session) — this field is what the "how much context is used"
   *  meter should read instead, so it doesn't report e.g. 150% on a perfectly healthy session. */
  liveContextTokens: number;

  turnCount: number;
  observationCount: number;
  toolCallCount: number;
  errorCount: number;

  parentSessionId?: string;
  /** Count of sessions with `parentSessionId === this.id`, computed at query time via a correlated subquery — not a stored column. */
  subAgentCount: number;

  sourceFile: string;

  analysisStatus: "pending" | "complete" | "partial" | "failed";

  /** Manual user rating, kept separate from any derived outcome. */
  userScore: "good" | "bad" | "";

  /** Studio-only metadata (never written back to the provider's session file). */
  pinned: boolean;
  favorite: boolean;

  /** Cached mirror of the same evidence-only classification computed at analysis time (see classifySessionOutcome) — lets the session list show it without loading every observation per row. */
  outcome: TSessionOutcome;

  /** Best-effort model max-context-window estimate (see ai-model-context-windows.ts) — not billing data, applied at read time, never persisted. */
  contextWindowTokens: number;

  /** Cheap Advisor grade estimate (see computeQuickGrade in ai-session-advisor.ts) — computed at read time from this row alone, so it omits the orchestration dimension and can differ slightly from the full grade returned by GET .../advisor. undefined when the session hasn't done enough to score. */
  advisorGrade?: "A" | "B" | "C" | "D" | "F";
  advisorScore?: number;
};

export type TAiTurn = {
  id: string;
  sessionId: string;

  index: number;

  userRequest: string;

  startedAt: string;
  endedAt?: string;

  durationMs: number;

  inputTokens: number;
  outputTokens: number;

  toolCount: number;
  errorCount: number;

  /** True for the synthetic "session context" pseudo-turn (leading observations with no human root). */
  isContext: boolean;

  status: "completed" | "failed" | "cancelled" | "unknown";
};

// --- Provider adapter contract ------------------------------------------------

export type TSessionFile = {
  path: string;
  provider: TAiProvider;
  modifiedAtMs: number;
  sizeBytes: number;
};

export type TParsedAiSession = {
  session: Omit<
    TAiSession,
    | "analysisStatus"
    | "userScore"
    | "pinned"
    | "favorite"
    | "outcome"
    | "turnCount"
    | "durationMs"
    | "toolCallCount"
    | "errorCount"
    | "observationCount"
    | "subAgentCount"
    | "contextWindowTokens"
  >;
  observations: TAiObservation[];
};

export interface IAiSessionProvider {
  readonly id: TAiProvider;
  discoverSessionFiles(): Promise<TSessionFile[]>;
  parseSession(file: TSessionFile, content: string): TParsedAiSession | undefined;
}

// --- Incremental ingestion tracking -------------------------------------------

export type TIngestedSessionFile = {
  path: string;
  modifiedAtMs: number;
  sizeBytes: number;
  provider: TAiProvider;
  lastIngestedAt: string;
};

export type TParserDiagnosticSeverity = "info" | "warning" | "error";

export type TParserDiagnostic = {
  provider: TAiProvider;
  sourceFile: string;
  severity: TParserDiagnosticSeverity;
  recordType?: string;
  message: string;
  sample?: string;
  occurredAt: string;
};

export type TIngestionResult = {
  filesDiscovered: number;
  filesIngested: number;
  filesSkippedUnchanged: number;
  filesFailed: number;
  diagnostics: TParserDiagnostic[];
  durationMs: number;
};

// --- Analysis layer (derived + inferred, always labelled) ---------------------

/** How a piece of Studio-displayed information was obtained. Never omit this from a UI-facing payload. */
export type TEvidenceBasis = "observed" | "derived" | "inferred" | "unknown";

export type TToolUsageStat = {
  name: string;
  callCount: number;
  totalDurationMs: number;
  errorCount: number;
  /** Observation ids for the slowest calls, for drill-down. */
  slowestObservationIds: string[];
};

export type TErrorGroup = {
  category:
    | "file-not-found"
    | "permission-denied"
    | "command-failed"
    | "build-failed"
    | "test-failed"
    | "typescript-error"
    | "git-conflict"
    | "network-error"
    | "authentication-error"
    | "tool-cancelled"
    | "user-rejected"
    | "parser-error"
    | "unknown";
  message: string;
  count: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  observationIds: string[];
  affectedTurnIndexes: number[];
};

export type TVerificationCheckKind =
  | "typecheck"
  | "build"
  | "unit-test"
  | "integration-test"
  | "lint"
  | "git-status"
  | "git-diff"
  | "app-startup"
  | "other";

export type TVerificationStatus = "pass" | "fail" | "partial" | "not-run" | "unknown";

export type TVerificationCheck = {
  kind: TVerificationCheckKind;
  label: string;
  status: TVerificationStatus;
  observationId: string;
  durationMs?: number;
};

export type TFileImpact = {
  path: string;
  reads: number;
  edits: number;
  firstTurnIndex: number;
  lastTurnIndex: number;
};

export type TSessionOutcome = "successful" | "partially-successful" | "failed" | "cancelled" | "unverified" | "unknown";

export type TLoopFindingKind = "repeated-command" | "repeated-read" | "repeated-search" | "edit-revert-cycle" | "build-without-change" | "repeated-failure";

export type TLoopFinding = {
  kind: TLoopFindingKind;
  confidence: number;
  observationIds: string[];
  evidence: string[];
  recommendation: string;
};

export type TSessionAnalysis = {
  sessionId: string;
  outcome: TSessionOutcome;
  outcomeEvidence: string[];
  toolUsage: TToolUsageStat[];
  errorGroups: TErrorGroup[];
  verification: TVerificationCheck[];
  fileImpact: TFileImpact[];
  commandsRun: string[];
  loopFindings: TLoopFinding[];
};

// --- Advisor layer (derived, heuristic scoring — always labelled as an estimate,
// never treated as billing/ground-truth data) ------------------------------------

export type TAdvisorDimension = { label: string; score: number };

export type TAdvisorRecommendation = {
  category: "context" | "cache" | "model-fit" | "orchestration";
  severity: "warning" | "critical";
  title: string;
  detail: string;
  metric?: string;
};

/** One node in the whole-session orchestration tree — the main session itself (depth 0) plus
 *  each of its sub-agent sessions (depth >= 1). Distinct from the per-turn Graph view's
 *  observation tree: this shows the session hierarchy, not one turn's tool-call tree. */
export type TSessionAgent = {
  sessionId: string;
  agentId: string;
  type: string;
  model: string;
  tokens: number;
  toolCallCount: number;
  durationMs: number;
  /** Approximated from `endedAt` recency — there is no true live/running signal in this ingestion-based architecture. */
  status: "running" | "done";
  spawnReason?: string;
  depth: number;
};

export type TSessionAdvisor = {
  /** True when the session has too little activity to score meaningfully — the UI hides the whole Advisor section rather than showing a misleading grade. */
  neutral: boolean;
  grade: "A" | "B" | "C" | "D" | "F" | "";
  score: number;
  dimensions: TAdvisorDimension[];
  recommendations: TAdvisorRecommendation[];
  agents: TSessionAgent[];
  tokenEconomics: {
    totalTokens: number;
    byAgent: Array<{ label: string; tokens: number }>;
    byModel: Array<{ label: string; tokens: number }>;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    /** undefined when there's too little cache signal to report a meaningful percentage. */
    cacheReusePercent: number | undefined;
  };
};
