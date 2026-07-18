import { execa } from "execa";
import { classifyForExport, groupObservationsByTurn } from "./export/ai-export-content";
import { deriveTurns } from "./ai-session-analysis";
import { redactSecrets } from "./ai-secret-redaction";
import { isClaudeCliAvailable } from "./ai-session-command-service";
import type { TAiObservation, TAiSession } from "./ai-types";

const MAX_CONTEXT_CHARS = 24000;
/** Cheapest current Anthropic model — this is a self-summarization aid, not a task the user is paying premium-model attention for. */
const SUMMARY_MODEL = "claude-haiku-4-5-20251001";

function isCompactBoundary(observation: TAiObservation): boolean {
  try {
    return JSON.parse(observation.metadata || "{}").compactBoundary === true;
  } catch {
    return false;
  }
}

/**
 * Reconstructs a readable transcript of the session's *current* live context: everything from the
 * last auto-compaction boundary onward (see the `compactBoundary` metadata set in
 * claude-session-provider.ts), or the whole session if it was never compacted. Content before a
 * boundary is deliberately excluded — Claude Code has already summarized that away and no longer
 * holds it verbatim, so including it here would misrepresent what the model actually retains.
 * Truncates from the *front* (keeping the most recent content) when still over budget, since that's
 * what's most relevant to "what does the AI currently understand."
 */
export function buildCurrentContextTranscript(observations: TAiObservation[]): { text: string; truncated: boolean } {
  const lastBoundaryIdx = observations.reduce((found, observation, index) => (isCompactBoundary(observation) ? index : found), -1);
  const relevant = lastBoundaryIdx >= 0 ? observations.slice(lastBoundaryIdx) : observations;

  const turns = deriveTurns(relevant);
  const grouped = groupObservationsByTurn(turns, relevant);
  const lines: string[] = [];
  const TOOL_KINDS = new Set(["tool-call", "shell-command", "mcp-call", "skill", "subagent"]);

  for (const turn of turns) {
    for (const observation of grouped.get(turn.index) ?? []) {
      const kind = classifyForExport(observation);
      if (kind === "user") lines.push(`User: ${redactSecrets(observation.input || observation.output)}`);
      else if (kind === "assistant") lines.push(`Assistant: ${redactSecrets(observation.output)}`);
      else if (TOOL_KINDS.has(observation.type)) {
        const detail = observation.type === "shell-command" ? redactSecrets(observation.input).split(/\r?\n/)[0]?.slice(0, 160) : "";
        lines.push(`[ran ${observation.name}${detail ? `: ${detail}` : ""}]`);
      }
    }
  }

  let text = lines.join("\n\n");
  let truncated = false;
  if (text.length > MAX_CONTEXT_CHARS) {
    text = text.slice(text.length - MAX_CONTEXT_CHARS);
    truncated = true;
  }
  return { text, truncated };
}

export type TContextSummaryResult = { ok: true; summary: string } | { ok: false; error: string };

/**
 * Asks the model itself (a fresh, unpersisted headless call — never `--resume`, so this never
 * touches the real session's own transcript) to summarize its current understanding of the
 * reconstructed live-context transcript above. On-demand only: never runs during ingestion/refresh,
 * only when the user explicitly asks for it, since it costs a real (small) API call.
 */
export async function summarizeCurrentContext(session: TAiSession, observations: TAiObservation[]): Promise<TContextSummaryResult> {
  if (session.provider !== "claude") return { ok: false, error: "Context summarization is only available for Claude Code sessions right now." };
  if (!(await isClaudeCliAvailable())) return { ok: false, error: "The 'claude' CLI was not found on PATH." };

  const { text, truncated } = buildCurrentContextTranscript(observations);
  if (!text.trim()) return { ok: false, error: "This session has no content to summarize yet." };

  const prompt = [
    "You are looking at a transcript of your own past coding session (not the current conversation).",
    truncated ? "Only the most recent portion is shown below; earlier content in this window was truncated for length." : "",
    "Based ONLY on the transcript below, give a short bulleted answer covering:",
    "- What is the current task/goal?",
    "- What has been done so far?",
    "- Anything ambiguous, unresolved, or that a fresh reader (or a version of you that later forgot this) should watch out for. Be honest if you're unsure about something.",
    "",
    "--- TRANSCRIPT ---",
    text,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    // The reconstructed transcript can easily be 20k+ chars — passing it as a CLI argument hits
    // Windows' command-line length limit ("The command line is too long"). Piping it over stdin
    // instead (no positional prompt argument, `-p` alone reads from stdin) has no such limit.
    const result = await execa("claude", ["-p", "--no-session-persistence", "--model", SUMMARY_MODEL], { input: prompt, cwd: session.cwd, timeout: 90_000 });
    const summary = result.stdout.trim();
    if (!summary) return { ok: false, error: "The model returned an empty response." };
    return { ok: true, summary };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
