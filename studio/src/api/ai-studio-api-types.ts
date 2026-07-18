/**
 * Hand-maintained mirror of src/core/ai/ai-types.ts — the browser-safe shapes returned by the
 * local AI Studio API (src/core/ai/studio/ai-studio-routes.ts). Keep in sync with the backend.
 */

export type TAiProvider = "claude" | "codex" | "cursor" | "unknown";

export type TAiObservationType = "user" | "assistant" | "reasoning" | "tool-call" | "shell-command" | "mcp-call" | "skill" | "subagent" | "command" | "error";

export type TAiObservation = {
  id: string;
  sessionId: string;
  idx: number;
  type: TAiObservationType;
  name: string;
  startedAt: string;
  durationMs: number;
  input: string;
  output: string;
  tokens: number;
  sidechain: boolean;
  parentId: string;
  isError: boolean;
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
  cacheCreationTokens: number;
  /** Most recent turn's context snapshot (not a lifetime sum) — what the "Context" meter should read. */
  liveContextTokens: number;
  turnCount: number;
  observationCount: number;
  toolCallCount: number;
  errorCount: number;
  parentSessionId?: string;
  subAgentCount: number;
  sourceFile: string;
  analysisStatus: "pending" | "complete" | "partial" | "failed";
  userScore: "good" | "bad" | "";
  pinned: boolean;
  favorite: boolean;
  outcome: TSessionOutcome;
  contextWindowTokens: number;
  advisorGrade?: "A" | "B" | "C" | "D" | "F";
  advisorScore?: number;
};

export type TAdvisorDimension = { label: string; score: number };

export type TAdvisorRecommendation = {
  category: "context" | "cache" | "model-fit" | "orchestration";
  severity: "warning" | "critical";
  title: string;
  detail: string;
  metric?: string;
};

export type TSessionAgent = {
  sessionId: string;
  agentId: string;
  type: string;
  model: string;
  tokens: number;
  toolCallCount: number;
  durationMs: number;
  status: "running" | "done";
  spawnReason?: string;
  depth: number;
};

export type TSessionAdvisor = {
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
    cacheReusePercent: number | undefined;
  };
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
  isContext: boolean;
  status: "completed" | "failed" | "cancelled" | "unknown";
};

export type TToolUsageStat = {
  name: string;
  callCount: number;
  totalDurationMs: number;
  errorCount: number;
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

export type TVerificationCheck = {
  kind: "typecheck" | "build" | "unit-test" | "integration-test" | "lint" | "git-status" | "git-diff" | "app-startup" | "other";
  label: string;
  status: "pass" | "fail" | "partial" | "not-run" | "unknown";
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

export type TSessionAnalysis = {
  sessionId: string;
  outcome: TSessionOutcome;
  outcomeEvidence: string[];
  toolUsage: TToolUsageStat[];
  errorGroups: TErrorGroup[];
  verification: TVerificationCheck[];
  fileImpact: TFileImpact[];
  commandsRun: string[];
  loopFindings: unknown[];
};

export type TParserDiagnostic = {
  provider: TAiProvider;
  sourceFile: string;
  severity: "info" | "warning" | "error";
  recordType?: string;
  message: string;
  sample?: string;
  occurredAt: string;
};

export type TAiOverview = {
  totalSessions: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalDurationMs: number;
  totalToolCalls: number;
  totalErrors: number;
  byProvider: Array<{ provider: string; count: number }>;
};

export type TAiDoctorReport = {
  claudeFilesIngested: number;
  codexFilesIngested: number;
  totalSessions: number;
  diagnostics: TParserDiagnostic[];
  storageDir: string;
};

export type TIngestionResult = {
  filesDiscovered: number;
  filesIngested: number;
  filesSkippedUnchanged: number;
  filesFailed: number;
  diagnostics: TParserDiagnostic[];
  durationMs: number;
};

export type TSessionListResponse = { sessions: TAiSession[]; nextCursor?: string };

// --- Session launcher / resume ---------------------------------------------------

export type TShellKind = "powershell" | "cmd" | "bash" | "zsh" | "unknown";

export type TAiSessionLaunchCommand = {
  provider: "claude";
  sessionId: string;
  sessionName?: string;
  workingDirectory: string;
  command: string;
  executable: string;
  args: string[];
  shell: TShellKind;
};

export type TAiSessionLaunchResponse = {
  provider: TAiProvider;
  canResume: boolean;
  reason?: string;
  workingDirectory: string;
  workingDirectoryExists: boolean;
  commands?: {
    resume: TAiSessionLaunchCommand;
    resumeWithWorkingDirectory: TAiSessionLaunchCommand;
    continueLatestInProject: TAiSessionLaunchCommand;
  };
  capabilities: {
    copyCommand: boolean;
    openTerminal: boolean;
    openProject: boolean;
    openVsCode: boolean;
  };
};

export type TAiActionResult = { ok: boolean; error?: string };

/** Result of an on-demand "Summarize context" call (see /summarize-context) — a real, small API
 *  call the model makes about its own reconstructed current context, only run when the user asks. */
export type TContextSummaryResult = { ok: true; summary: string } | { ok: false; error: string };

// --- Export system (src/core/ai/export/ai-export-types.ts) -----------------------

/** "pdf" is deliberately not a backend format — Export PDF fetches the html export and opens it for the browser's own print-to-PDF. */
export type TAiExportFormat = "markdown" | "html" | "json" | "zip";

export type TAiExportPreset = "conversation" | "learning" | "engineering" | "full" | "custom";

export type TAiExportInclude = {
  conversation: boolean;
  toolCalls: boolean;
  toolOutputs: boolean;
  reasoning: boolean;
  files: boolean;
  commands: boolean;
  errors: boolean;
  verification: boolean;
  rawMetadata: boolean;
};

export type TAiSessionExportInput = {
  format: TAiExportFormat;
  preset: TAiExportPreset;
  include?: Partial<TAiExportInclude>;
  redactSecrets: boolean;
  includeLocalPaths: boolean;
  theme: "light" | "dark";
};

export type TAiExportPreview = {
  format: TAiExportFormat;
  preset: TAiExportPreset;
  include: TAiExportInclude;
  sections: { included: string[]; excluded: string[] };
  redactedFieldCount: number;
  estimatedBytes: number;
};
