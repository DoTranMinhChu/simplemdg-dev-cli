import { redactSecrets } from "./ai-secret-redaction";
import type {
  TAiObservation,
  TAiSession,
  TAiTurn,
  TErrorGroup,
  TFileImpact,
  TSessionAnalysis,
  TSessionOutcome,
  TToolUsageStat,
  TVerificationCheck,
  TVerificationCheckKind,
  TVerificationStatus,
} from "./ai-types";

const TOOL_TYPES = new Set(["tool-call", "shell-command", "mcp-call", "skill", "subagent"]);

/**
 * Groups a session's flat observation list into Turns. A Turn begins with a real human input
 * (type "user" or "command") sitting at the top of the tree (parentId === ""); every other
 * observation belongs to the Turn reached by walking parentId up to its topmost ancestor. This is
 * robust to subagent transcripts spliced into the parent session, whose observations chain up
 * through the spawning tool node. Observations that never reach a human root (e.g. leading
 * protocol/context lines before any prompt) are grouped into a single synthetic "context" turn
 * with index 0 and isContext=true — never silently dropped, never attributed to the wrong turn.
 */
export function deriveTurns(observations: TAiObservation[]): TAiTurn[] {
  const byId = new Map(observations.map((observation) => [observation.id, observation]));

  const topmost = (observation: TAiObservation): TAiObservation => {
    let current = observation;
    const guard = new Set<string>();
    while (current.parentId && byId.has(current.parentId) && !guard.has(current.id)) {
      guard.add(current.id);
      current = byId.get(current.parentId) as TAiObservation;
    }
    return current;
  };

  const isHumanRoot = (observation: TAiObservation): boolean => (observation.type === "user" || observation.type === "command") && !observation.parentId;

  type TDraftTurn = {
    rootId: string;
    isContext: boolean;
    observations: TAiObservation[];
  };

  const draftsByKey = new Map<string, TDraftTurn>();
  const order: string[] = [];

  for (const observation of observations) {
    const root = topmost(observation);
    const key = isHumanRoot(root) ? root.id : "__context__";
    let draft = draftsByKey.get(key);
    if (!draft) {
      draft = { rootId: key === "__context__" ? "" : root.id, isContext: key === "__context__", observations: [] };
      draftsByKey.set(key, draft);
      order.push(key);
    }
    draft.observations.push(observation);
  }

  let turnIndex = 0;
  return order.map((key) => {
    const draft = draftsByKey.get(key) as TDraftTurn;
    const sessionId = observations[0]?.sessionId ?? "";
    const sorted = [...draft.observations].sort((a, b) => a.idx - b.idx);
    const root = sorted.find((observation) => observation.id === draft.rootId);
    const tokens = sorted.reduce((sum, observation) => sum + observation.tokens, 0);
    const toolCount = sorted.filter((observation) => TOOL_TYPES.has(observation.type)).length;
    const errorCount = sorted.filter((observation) => observation.isError).length;
    const startedAt = sorted[0]?.startedAt ?? "";
    const endedAt = sorted[sorted.length - 1]?.startedAt;
    const index = draft.isContext ? 0 : ++turnIndex;

    return {
      id: `${sessionId}:turn:${draft.isContext ? "context" : index}`,
      sessionId,
      index,
      userRequest: draft.isContext ? "(session context — no user prompt)" : root?.input || root?.output || `Turn ${index}`,
      startedAt,
      endedAt,
      durationMs: elapsedMs(startedAt, endedAt),
      inputTokens: 0,
      outputTokens: tokens,
      toolCount,
      errorCount,
      isContext: draft.isContext,
      status: errorCount > 0 ? "failed" : "completed",
    } satisfies TAiTurn;
  });
}

function elapsedMs(from: string, to: string | undefined): number {
  if (!to) return 0;
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

// --- Tool usage --------------------------------------------------------------

export function analyzeToolUsage(observations: TAiObservation[]): TToolUsageStat[] {
  const byName = new Map<string, { calls: TAiObservation[] }>();
  for (const observation of observations) {
    if (!TOOL_TYPES.has(observation.type)) continue;
    const entry = byName.get(observation.name) ?? { calls: [] };
    entry.calls.push(observation);
    byName.set(observation.name, entry);
  }

  return [...byName.entries()]
    .map(([name, { calls }]) => {
      const sorted = [...calls].sort((a, b) => b.durationMs - a.durationMs);
      return {
        name,
        callCount: calls.length,
        totalDurationMs: calls.reduce((sum, call) => sum + call.durationMs, 0),
        errorCount: calls.filter((call) => call.isError).length,
        slowestObservationIds: sorted.slice(0, 5).map((call) => call.id),
      } satisfies TToolUsageStat;
    })
    .sort((a, b) => b.callCount - a.callCount);
}

// --- Error grouping ------------------------------------------------------------

const ERROR_PATTERNS: Array<{ category: TErrorGroup["category"]; pattern: RegExp }> = [
  { category: "file-not-found", pattern: /no such file|enoent|cannot find (the )?(file|path|module)|does not exist/i },
  { category: "permission-denied", pattern: /permission denied|eacces|access is denied/i },
  { category: "typescript-error", pattern: /\bTS\d{4}\b|type error|is not assignable to type/i },
  { category: "build-failed", pattern: /build failed|compilation failed|webpack|vite build/i },
  { category: "test-failed", pattern: /test failed|\d+ failing|assertionerror|expect\(received\)/i },
  { category: "git-conflict", pattern: /merge conflict|conflict in|CONFLICT \(/i },
  { category: "network-error", pattern: /econnrefused|econnreset|enotfound|network error|timed out/i },
  { category: "authentication-error", pattern: /authentication failed|unauthorized|401|invalid credentials/i },
  { category: "user-rejected", pattern: /user (rejected|denied|declined)/i },
  { category: "tool-cancelled", pattern: /cancelled|aborted/i },
  { category: "command-failed", pattern: /command failed|exit code [1-9]|non-zero exit/i },
];

/** Groups error-flagged observations by a short, deterministic first-line signature, then classifies each group. */
export function analyzeErrors(observations: TAiObservation[], turns: TAiTurn[]): TErrorGroup[] {
  const groups = new Map<string, TErrorGroup>();
  for (const observation of observations) {
    if (!observation.isError && !observation.output.toLowerCase().includes("error")) continue;
    if (!observation.isError) continue; // Only explicit tool-reported errors, never guessed from text alone.

    const signature = redactSecrets(firstLine(observation.output) || firstLine(observation.input) || observation.name);
    const category = classifyError(observation.output || observation.input);
    const key = `${category}:${signature.slice(0, 120)}`;
    const affectedTurnIndex = findEnclosingTurnIndex(turns, observation.startedAt);

    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastOccurredAt = observation.startedAt;
      existing.observationIds.push(observation.id);
      if (affectedTurnIndex != null && !existing.affectedTurnIndexes.includes(affectedTurnIndex)) existing.affectedTurnIndexes.push(affectedTurnIndex);
    } else {
      groups.set(key, {
        category,
        message: signature,
        count: 1,
        firstOccurredAt: observation.startedAt,
        lastOccurredAt: observation.startedAt,
        observationIds: [observation.id],
        affectedTurnIndexes: affectedTurnIndex != null ? [affectedTurnIndex] : [],
      });
    }
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

function findEnclosingTurnIndex(turns: TAiTurn[], startedAt: string): number | undefined {
  const time = Date.parse(startedAt);
  if (!Number.isFinite(time)) return undefined;
  for (const turn of turns) {
    const turnStart = Date.parse(turn.startedAt);
    const turnEnd = turn.endedAt ? Date.parse(turn.endedAt) : turnStart;
    if (Number.isFinite(turnStart) && time >= turnStart && time <= turnEnd + 1) return turn.index;
  }
  return undefined;
}

function classifyError(text: string): TErrorGroup["category"] {
  for (const { category, pattern } of ERROR_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return "unknown";
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
}

// --- Verification evidence -----------------------------------------------------

const VERIFICATION_COMMANDS: Array<{ kind: TVerificationCheckKind; pattern: RegExp; label: string }> = [
  { kind: "typecheck", pattern: /\b(tsc\b|typecheck|type-check)/i, label: "Typecheck" },
  { kind: "build", pattern: /\b(npm|pnpm|yarn)\s+run\s+build\b|vite build|webpack --mode production/i, label: "Build" },
  { kind: "unit-test", pattern: /\b(npm|pnpm|yarn)\s+(run\s+)?test\b|jest|vitest|mocha/i, label: "Unit test" },
  { kind: "integration-test", pattern: /playwright|cypress|e2e/i, label: "Integration test" },
  { kind: "lint", pattern: /\beslint\b|\blint\b/i, label: "Lint" },
  { kind: "git-status", pattern: /git status/i, label: "Git status" },
  { kind: "git-diff", pattern: /git diff/i, label: "Git diff" },
];

/** Detects likely verification commands among shell-command observations and infers pass/fail from output + exit signal. */
export function analyzeVerification(observations: TAiObservation[]): TVerificationCheck[] {
  const checks: TVerificationCheck[] = [];
  for (const observation of observations) {
    if (observation.type !== "shell-command") continue;
    const match = VERIFICATION_COMMANDS.find((entry) => entry.pattern.test(observation.input));
    if (!match) continue;

    checks.push({
      kind: match.kind,
      label: match.label,
      status: inferVerificationStatus(observation),
      observationId: observation.id,
      durationMs: observation.durationMs || undefined,
    });
  }
  return checks;
}

function inferVerificationStatus(observation: TAiObservation): TVerificationStatus {
  if (observation.isError) return "fail";
  const output = observation.output.toLowerCase();
  if (!output.trim()) return "unknown";
  if (/\b0 errors?\b|\bpassed\b|\ball tests passed\b|built in \d/.test(output) && !/\bfailed\b|\berror(s)?\b(?!.*0 error)/.test(output)) return "pass";
  if (/error ts\d|\bfailed\b|\d+ failing/.test(output)) return "fail";
  return "unknown";
}

// --- File impact --------------------------------------------------------------

const FILE_READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit", "apply_patch"]);

export function analyzeFileImpact(observations: TAiObservation[], turns: TAiTurn[]): TFileImpact[] {
  const byPath = new Map<string, TFileImpact>();

  for (const observation of observations) {
    if (observation.type !== "tool-call") continue;
    const filePath = extractFilePath(observation);
    if (!filePath) continue;

    const turnIndex = findEnclosingTurnIndex(turns, observation.startedAt) ?? 0;
    const isWrite = FILE_WRITE_TOOLS.has(observation.name);
    const isRead = FILE_READ_TOOLS.has(observation.name);
    if (!isWrite && !isRead) continue;

    const existing = byPath.get(filePath);
    if (existing) {
      if (isRead) existing.reads += 1;
      if (isWrite) existing.edits += 1;
      existing.firstTurnIndex = Math.min(existing.firstTurnIndex, turnIndex);
      existing.lastTurnIndex = Math.max(existing.lastTurnIndex, turnIndex);
    } else {
      byPath.set(filePath, { path: filePath, reads: isRead ? 1 : 0, edits: isWrite ? 1 : 0, firstTurnIndex: turnIndex, lastTurnIndex: turnIndex });
    }
  }

  return [...byPath.values()].sort((a, b) => b.edits - a.edits || b.reads - a.reads);
}

function extractFilePath(observation: TAiObservation): string | undefined {
  try {
    const data = JSON.parse(observation.input) as Record<string, unknown>;
    const candidate = data.file_path ?? data.notebook_path ?? data.path;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  } catch {
    // Not JSON input; no file path to extract.
  }
  return undefined;
}

export function extractCommands(observations: TAiObservation[]): string[] {
  const commands = observations.filter((observation) => observation.type === "shell-command").map((observation) => redactSecrets(observation.input.trim()));
  return [...new Set(commands)];
}

// --- Outcome -------------------------------------------------------------------

/** Conservative, evidence-only outcome. Never claims success from assistant text alone. */
export function classifySessionOutcome(options: { errorCount: number; verification: TVerificationCheck[] }): { outcome: TSessionOutcome; evidence: string[] } {
  const evidence: string[] = [];
  const failedChecks = options.verification.filter((check) => check.status === "fail");
  const passedChecks = options.verification.filter((check) => check.status === "pass");

  if (options.verification.length === 0) {
    evidence.push("No verification commands (typecheck/build/test/lint) were observed in this session.");
    return { outcome: options.errorCount > 0 ? "failed" : "unverified", evidence };
  }

  for (const check of passedChecks) evidence.push(`${check.label} passed.`);
  for (const check of failedChecks) evidence.push(`${check.label} failed.`);

  if (failedChecks.length > 0 && passedChecks.length > 0) return { outcome: "partially-successful", evidence };
  if (failedChecks.length > 0) return { outcome: "failed", evidence };
  if (passedChecks.length > 0 && options.errorCount === 0) return { outcome: "successful", evidence };
  if (passedChecks.length > 0) return { outcome: "partially-successful", evidence };
  return { outcome: "unknown", evidence };
}

// --- Full session analysis (composes the above) --------------------------------

export function analyzeSession(sessionId: string, observations: TAiObservation[]): TSessionAnalysis {
  const turns = deriveTurns(observations);
  const toolUsage = analyzeToolUsage(observations);
  const errorGroups = analyzeErrors(observations, turns);
  const verification = analyzeVerification(observations);
  const fileImpact = analyzeFileImpact(observations, turns);
  const commandsRun = extractCommands(observations);
  const errorCount = observations.filter((observation) => observation.isError).length;
  const { outcome, evidence } = classifySessionOutcome({ errorCount, verification });

  return {
    sessionId,
    outcome,
    outcomeEvidence: evidence,
    toolUsage,
    errorGroups,
    verification,
    fileImpact,
    commandsRun,
    loopFindings: [],
  };
}

// --- Continuation prompt --------------------------------------------------------

/**
 * Builds a "resume with context" prompt for pasting into a new/continued Claude Code session.
 * Every section is sourced from `analysis`/`turns` (already observed-only per classifySessionOutcome
 * and analyzeErrors/analyzeVerification) — this never invents claims about what was accomplished.
 */
export function buildContinuationPrompt(session: TAiSession, turns: TAiTurn[], analysis: TSessionAnalysis): string {
  const lines: string[] = [];
  const realTurns = turns.filter((turn) => !turn.isContext);
  const lastTurn = realTurns[realTurns.length - 1];

  lines.push(`Continuing work from a previous Claude Code session in "${session.project}" (${session.cwd}).`);
  if (session.gitBranch) lines.push(`Git branch: ${session.gitBranch}.`);
  lines.push("");

  lines.push(`Previous session outcome: ${analysis.outcome}.`);
  for (const item of analysis.outcomeEvidence) lines.push(`- ${item}`);
  lines.push("");

  if (lastTurn) {
    lines.push(`Last request in that session (turn ${lastTurn.index}):`);
    lines.push(`"${redactSecrets(lastTurn.userRequest)}"`);
    lines.push("");
  }

  const failedChecks = analysis.verification.filter((check) => check.status === "fail");
  if (failedChecks.length > 0) {
    lines.push("Unresolved verification failures (observed):");
    for (const check of failedChecks) lines.push(`- ${check.label} failed.`);
    lines.push("");
  }

  const topErrors = analysis.errorGroups.slice(0, 5);
  if (topErrors.length > 0) {
    lines.push("Errors observed in the previous session:");
    for (const group of topErrors) lines.push(`- [${group.category}] ${group.message}${group.count > 1 ? ` (x${group.count})` : ""}`);
    lines.push("");
  }

  const recentFiles = [...analysis.fileImpact].sort((a, b) => b.lastTurnIndex - a.lastTurnIndex).slice(0, 8);
  if (recentFiles.length > 0) {
    lines.push("Files touched, most recently edited first:");
    for (const file of recentFiles) lines.push(`- ${file.path} (${file.edits} edit${file.edits === 1 ? "" : "s"}, ${file.reads} read${file.reads === 1 ? "" : "s"})`);
    lines.push("");
  }

  lines.push("Recommended next action:");
  lines.push(recommendNextAction(analysis));
  lines.push("");
  lines.push("(Generated from observed commands and their actual output in the previous session — not assumed from assistant text alone.)");

  return lines.join("\n");
}

function recommendNextAction(analysis: TSessionAnalysis): string {
  if (analysis.verification.some((check) => check.status === "fail")) {
    return "Re-run the failing verification command(s) above and fix the underlying issue before continuing.";
  }
  if (analysis.errorGroups.length > 0) {
    return "Review the errors above and confirm whether they were resolved before starting new work.";
  }
  if (analysis.verification.length === 0) {
    return "No verification (typecheck/build/test/lint) was observed in the previous session — consider running one to confirm the current state before continuing.";
  }
  return "Continue from where the previous session left off.";
}
