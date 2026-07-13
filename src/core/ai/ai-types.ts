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

  turnCount: number;
  observationCount: number;
  toolCallCount: number;
  errorCount: number;

  parentSessionId?: string;

  sourceFile: string;

  analysisStatus: "pending" | "complete" | "partial" | "failed";

  /** Manual user rating, kept separate from any derived outcome. */
  userScore: "good" | "bad" | "";
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
  session: Omit<TAiSession, "analysisStatus" | "userScore" | "turnCount" | "durationMs" | "toolCallCount" | "errorCount" | "observationCount">;
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
