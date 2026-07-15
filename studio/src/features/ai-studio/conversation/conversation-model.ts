import { observationsForTurn } from "../observations-for-turn";
import type { TAiObservation, TAiTurn } from "../../../api/ai-studio-api-types";

/**
 * Presentation-level kind, richer than the stored `TAiObservationType`. Derived entirely from
 * existing fields (type/name) — nothing here is a new stored concept. Deliberately has no
 * "tool-result" or "verification" member: a tool's result lives on the *same* observation as its
 * input (there's no separate stored record for it), and "verification" is a badge overlay computed
 * from `analysis.verification`, not a distinct kind — see isVerificationObservation below.
 */
export type TConversationEntryKind =
  | "user-message"
  | "assistant-message"
  | "reasoning"
  | "tool-call"
  | "shell-command"
  | "file-read"
  | "file-write"
  | "file-edit"
  | "subagent"
  | "skill"
  | "error"
  | "system-event";

// Mirrors FILE_READ_TOOLS/FILE_WRITE_TOOLS in src/core/ai/ai-session-analysis.ts, split further into
// write-vs-edit since the frontend only sees the API-shaped types and has no shared module with the backend.
const FILE_READ_TOOLS = new Set(["Read", "Glob", "Grep"]);
const FILE_WRITE_TOOLS = new Set(["Write"]);
const FILE_EDIT_TOOLS = new Set(["Edit", "MultiEdit", "NotebookEdit", "apply_patch"]);

export function deriveConversationKind(observation: TAiObservation): TConversationEntryKind {
  switch (observation.type) {
    case "user":
      return "user-message";
    case "assistant":
      return "assistant-message";
    case "reasoning":
      return "reasoning";
    case "shell-command":
      return "shell-command";
    case "skill":
      return "skill";
    case "subagent":
      return "subagent";
    case "command":
      return "system-event";
    case "error":
      return "error";
    case "mcp-call":
      return "tool-call";
    case "tool-call":
      if (FILE_READ_TOOLS.has(observation.name)) return "file-read";
      if (FILE_WRITE_TOOLS.has(observation.name)) return "file-write";
      if (FILE_EDIT_TOOLS.has(observation.name)) return "file-edit";
      return "tool-call";
    default:
      return "tool-call";
  }
}

const VERIFICATION_HINT = /\b(tsc|typecheck|type-check|build|test|lint|jest|vitest|playwright|cypress)\b/i;

/** Same heuristic SessionTimeline.tsx already uses — a badge overlay, not a separate kind. */
export function isVerificationObservation(observation: TAiObservation): boolean {
  return observation.type === "shell-command" && VERIFICATION_HINT.test(observation.input);
}

export function parseMetadata(observation: TAiObservation): Record<string, unknown> {
  if (!observation.metadata) return {};
  try {
    const parsed: unknown = JSON.parse(observation.metadata);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Best-effort file path extraction from a tool call's JSON input — mirrors extractFilePath in ai-session-analysis.ts. */
export function extractFilePath(observation: TAiObservation): string | undefined {
  try {
    const data = JSON.parse(observation.input) as Record<string, unknown>;
    const candidate = data.file_path ?? data.notebook_path ?? data.path;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  } catch {
    // Not JSON input; no file path to extract.
  }
  return undefined;
}

export type TConversationBlock =
  | { kind: "user"; observation: TAiObservation }
  | { kind: "assistant"; observation: TAiObservation }
  | { kind: "activity-group"; observations: TAiObservation[] };

/**
 * Walks a turn's observations in chronological order and interleaves them into user / assistant /
 * activity-group blocks — reproducing "USER -> AI -> AI ACTIVITY -> AI" instead of dumping every
 * tool call at the end of the turn. Reuses observationsForTurn's existing [startedAt, endedAt]
 * grouping rather than re-deriving turn membership.
 */
export function buildTurnTimeline(turn: TAiTurn, observations: TAiObservation[]): TConversationBlock[] {
  const turnObservations = [...observationsForTurn(observations, turn)].sort((a, b) => a.idx - b.idx);
  const blocks: TConversationBlock[] = [];
  let pendingActivity: TAiObservation[] = [];

  const flushActivity = (): void => {
    if (pendingActivity.length) {
      blocks.push({ kind: "activity-group", observations: pendingActivity });
      pendingActivity = [];
    }
  };

  for (const observation of turnObservations) {
    if (observation.type === "user" || observation.type === "command") {
      flushActivity();
      blocks.push({ kind: "user", observation });
    } else if (observation.type === "assistant") {
      flushActivity();
      blocks.push({ kind: "assistant", observation });
    } else {
      pendingActivity.push(observation);
    }
  }
  flushActivity();
  return blocks;
}

export type TToolUsageBreakdown = { name: string; count: number };

/** Per-turn breakdown of which tools ran and how many times each — same "counts as a tool"
 * definition `summarizeActivity` uses (COUNTS_AS_TOOL below), just grouped by name instead of
 * totaled, for the compact chip row under a turn's header. Most-called first. */
export function summarizeTurnToolUsage(turn: TAiTurn, observations: TAiObservation[]): TToolUsageBreakdown[] {
  const turnObservations = observationsForTurn(observations, turn);
  const counts = new Map<string, number>();
  for (const observation of turnObservations) {
    if (!COUNTS_AS_TOOL.has(deriveConversationKind(observation))) continue;
    counts.set(observation.name, (counts.get(observation.name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export type TActivitySummary = {
  toolCallCount: number;
  filesReadCount: number;
  filesEditedCount: number;
  shellCommandCount: number;
  errorCount: number;
  totalDurationMs: number;
};

const COUNTS_AS_TOOL: ReadonlySet<TConversationEntryKind> = new Set([
  "tool-call",
  "file-read",
  "file-write",
  "file-edit",
  "shell-command",
  "skill",
  "subagent",
]);

export function summarizeActivity(observations: TAiObservation[]): TActivitySummary {
  const summary: TActivitySummary = { toolCallCount: 0, filesReadCount: 0, filesEditedCount: 0, shellCommandCount: 0, errorCount: 0, totalDurationMs: 0 };
  for (const observation of observations) {
    const kind = deriveConversationKind(observation);
    summary.totalDurationMs += observation.durationMs;
    if (observation.isError) summary.errorCount += 1;
    if (kind === "file-read") summary.filesReadCount += 1;
    else if (kind === "file-write" || kind === "file-edit") summary.filesEditedCount += 1;
    else if (kind === "shell-command") summary.shellCommandCount += 1;
    if (COUNTS_AS_TOOL.has(kind)) summary.toolCallCount += 1;
  }
  return summary;
}

export type THeading = { level: number; text: string };

/** Regex line-scan for literal `#`-prefixed heading lines in assistant text — never invents headings. */
export function extractHeadings(text: string): THeading[] {
  const headings: THeading[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (match) headings.push({ level: match[1].length, text: match[2].trim() });
  }
  return headings;
}

/** Same [startedAt, endedAt] window observationsForTurn uses, inverted: given an observation, find its turn. */
export function findEnclosingTurnIndex(turns: TAiTurn[], observation: TAiObservation): number | undefined {
  const time = Date.parse(observation.startedAt);
  if (!Number.isFinite(time)) return undefined;
  for (const turn of turns) {
    const start = Date.parse(turn.startedAt);
    const end = turn.endedAt ? Date.parse(turn.endedAt) : start;
    if (Number.isFinite(start) && time >= start && time <= end + 1) return turn.index;
  }
  return undefined;
}

/** First non-empty line of the user's request, used as a nav/label title — never used to clip the rendered content itself. */
export function turnTitle(turn: TAiTurn): string {
  const firstLine = turn.userRequest.split(/\r?\n/).find((line) => line.trim())?.trim() ?? turn.userRequest;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine;
}
