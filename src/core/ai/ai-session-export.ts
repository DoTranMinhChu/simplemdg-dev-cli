import { redactSecrets } from "./ai-secret-redaction";
import type { TAiObservation, TAiSession, TAiTurn, TSessionAnalysis } from "./ai-types";

export type TAiExportFormat = "markdown" | "json";

export type TAiExportBundle = {
  session: TAiSession;
  turns: TAiTurn[];
  observations: TAiObservation[];
  analysis: TSessionAnalysis;
};

/** Exports always redact secrets — this is not the same "reveal" opt-in as viewing in Studio. */
export function exportSession(bundle: TAiExportBundle, format: TAiExportFormat): { content: string; mimeType: string; extension: string } {
  if (format === "json") {
    const redacted = {
      session: bundle.session,
      turns: bundle.turns,
      analysis: bundle.analysis,
      observations: bundle.observations.map((observation) => ({ ...observation, input: redactSecrets(observation.input), output: redactSecrets(observation.output) })),
    };
    return { content: JSON.stringify(redacted, null, 2), mimeType: "application/json", extension: "json" };
  }

  return { content: toMarkdown(bundle), mimeType: "text/markdown", extension: "md" };
}

function toMarkdown(bundle: TAiExportBundle): string {
  const { session, turns, analysis } = bundle;
  const lines: string[] = [];

  lines.push(`# ${session.title}`, "");
  lines.push(`- Provider: ${session.provider}`);
  lines.push(`- Project: ${session.project}`);
  lines.push(`- Model: ${session.model || "unknown"}`);
  lines.push(`- Started: ${session.startedAt}`);
  lines.push(`- Duration: ${formatDuration(session.durationMs)}`);
  lines.push(`- Tokens: ${(session.inputTokens + session.outputTokens).toLocaleString()} (cache-read ${session.cacheReadTokens.toLocaleString()})`);
  lines.push(`- Tool calls: ${session.toolCallCount}`);
  lines.push(`- Errors: ${session.errorCount}`, "");

  lines.push("## Outcome", "");
  lines.push(`**${labelOutcome(analysis.outcome)}** _(derived from observed verification evidence, not from assistant claims)_`, "");
  for (const evidence of analysis.outcomeEvidence) lines.push(`- ${evidence}`);
  lines.push("");

  if (analysis.verification.length) {
    lines.push("## Verification", "");
    for (const check of analysis.verification) lines.push(`- ${statusIcon(check.status)} ${check.label}${check.durationMs ? ` (${formatDuration(check.durationMs)})` : ""}`);
    lines.push("");
  }

  if (analysis.errorGroups.length) {
    lines.push("## Errors", "");
    for (const group of analysis.errorGroups) lines.push(`- **${group.category}** (${group.count}x): ${redactSecrets(group.message)}`);
    lines.push("");
  }

  if (analysis.fileImpact.length) {
    lines.push("## Files affected", "");
    for (const file of analysis.fileImpact.slice(0, 50)) lines.push(`- \`${file.path}\` — reads: ${file.reads}, edits: ${file.edits}`);
    lines.push("");
  }

  lines.push("## Turns", "");
  for (const turn of turns) {
    if (turn.isContext) continue;
    lines.push(`### Turn ${turn.index}`, "");
    lines.push(redactSecrets(clip(turn.userRequest, 500)), "");
    lines.push(`_Duration: ${formatDuration(turn.durationMs)} · Tools: ${turn.toolCount} · Errors: ${turn.errorCount}_`, "");
  }

  return lines.join("\n");
}

function labelOutcome(outcome: TSessionAnalysis["outcome"]): string {
  const labels: Record<TSessionAnalysis["outcome"], string> = {
    successful: "Successful",
    "partially-successful": "Partially successful",
    failed: "Failed",
    cancelled: "Cancelled",
    unverified: "Unverified",
    unknown: "Unknown",
  };
  return labels[outcome];
}

function statusIcon(status: string): string {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  if (status === "partial") return "⚠";
  return "?";
}

function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length)}…` : text;
}
