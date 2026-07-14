import { classifyForExport, formatDuration, groupObservationsByTurn, statusIcon } from "./ai-export-content";
import type { IAiSessionExporter, TAiExportBundle, TAiExportContext } from "./ai-export-types";

function labelOutcome(outcome: TAiExportBundle["analysis"]["outcome"]): string {
  const labels: Record<TAiExportBundle["analysis"]["outcome"], string> = {
    successful: "Successful",
    "partially-successful": "Partially successful",
    failed: "Failed",
    cancelled: "Cancelled",
    unverified: "Unverified",
    unknown: "Unknown",
  };
  return labels[outcome];
}

/**
 * A richer, `include`-aware sibling of `toMarkdown()` in ../ai-session-export.ts (which stays
 * untouched for the legacy export path) — walks each turn's observations in order rather than
 * just summarizing turn counts, so the full conversation reads as a document.
 */
function toRichMarkdown(bundle: TAiExportBundle, include: TAiExportContext["include"]): string {
  const { session, turns, observations, analysis } = bundle;
  const lines: string[] = [];

  lines.push(`# ${session.title}`, "");
  lines.push(`- Provider: ${session.provider}`);
  lines.push(`- Project: ${session.project}`);
  lines.push(`- Model: ${session.model || "unknown"}`);
  lines.push(`- Started: ${session.startedAt}`);
  lines.push(`- Duration: ${formatDuration(session.durationMs)}`);
  lines.push(`- Tokens: ${(session.inputTokens + session.outputTokens).toLocaleString()} (cache-read ${session.cacheReadTokens.toLocaleString()})`, "");

  lines.push("## Outcome", "");
  lines.push(`**${labelOutcome(analysis.outcome)}** _(derived from observed verification evidence, not from assistant claims)_`, "");
  for (const evidence of analysis.outcomeEvidence) lines.push(`- ${evidence}`);
  lines.push("");

  if (include.verification && analysis.verification.length) {
    lines.push("## Verification", "");
    for (const check of analysis.verification) lines.push(`- ${statusIcon(check.status)} ${check.label}${check.durationMs ? ` (${formatDuration(check.durationMs)})` : ""}`);
    lines.push("");
  }

  if (include.errors && analysis.errorGroups.length) {
    lines.push("## Errors", "");
    for (const group of analysis.errorGroups) lines.push(`- **${group.category}** (${group.count}x): ${group.message}`);
    lines.push("");
  }

  if (include.files && analysis.fileImpact.length) {
    lines.push("## Files changed", "");
    for (const file of analysis.fileImpact.slice(0, 200)) lines.push(`- \`${file.path}\` — reads: ${file.reads}, edits: ${file.edits}`);
    lines.push("");
  }

  if (include.commands && analysis.commandsRun.length) {
    lines.push("## Commands run", "");
    for (const command of analysis.commandsRun) lines.push(`- \`${command}\``);
    lines.push("");
  }

  if (include.conversation || include.toolCalls || include.toolOutputs || include.reasoning) {
    lines.push("## Conversation", "");
    const grouped = groupObservationsByTurn(turns, observations);
    for (const turn of turns) {
      if (turn.isContext) continue;
      lines.push(`### Turn ${turn.index}`, "");
      for (const observation of grouped.get(turn.index) ?? []) {
        const kind = classifyForExport(observation);
        if (kind === "user") {
          if (!include.conversation) continue;
          lines.push("**User:**", "", observation.input || observation.output, "");
        } else if (kind === "assistant") {
          if (!include.conversation) continue;
          lines.push("**Assistant:**", "", observation.output, "");
        } else if (kind === "reasoning") {
          if (!include.reasoning) continue;
          lines.push("> **Internal reasoning:**", ...observation.output.split(/\r?\n/).map((line) => `> ${line}`), "");
        } else if (include.toolOutputs) {
          lines.push(`**${observation.name}** _(${formatDuration(observation.durationMs)}${observation.isError ? ", failed" : ""})_`, "");
          if (observation.input) lines.push("```json", observation.input, "```", "");
          if (observation.output) lines.push("```", observation.output, "```", "");
        } else if (include.toolCalls) {
          lines.push(`- ${observation.name} (${formatDuration(observation.durationMs)}${observation.isError ? ", failed" : ""})`);
        }
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export const markdownExporter: IAiSessionExporter = {
  format: "markdown",
  export(bundle, context) {
    return { content: toRichMarkdown(bundle, context.include), mimeType: "text/markdown", extension: "md" };
  },
};
