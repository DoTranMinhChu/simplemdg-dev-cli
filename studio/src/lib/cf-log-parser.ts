export type TCfLogLevel = "error" | "warn" | "info" | "debug" | "unknown";

export type TCfLogLine = {
  raw: string;
  timestamp?: string;
  source?: string;
  stream?: "OUT" | "ERR";
  message: string;
  json?: Record<string, unknown>;
  level: TCfLogLevel;
};

// `cf logs <app> --recent` line shape: "<timestamp> [<source>] <OUT|ERR> <message>",
// e.g. `2026-07-23T09:30:00.22+0700 [APP/PROC/WEB/1] OUT {"level":"info",...}`. The CLI
// left-pads each line with spaces for column alignment, so leading whitespace is expected.
const CF_LOG_LINE = /^\s*(\S+)\s+\[([^\]]+)\]\s+(OUT|ERR)\s+([\s\S]*)$/;

function tryParseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function detectLevel(json: Record<string, unknown> | undefined, stream: string | undefined): TCfLogLevel {
  // The app's own structured JSON logs carry a "level" field — trust that over the CF stream
  // (OUT/ERR), since apps commonly log warnings/errors to stdout (OUT) rather than stderr.
  const rawLevel = json && typeof json.level === "string" ? json.level.toLowerCase() : undefined;
  if (rawLevel === "error" || rawLevel === "fatal") return "error";
  if (rawLevel === "warn" || rawLevel === "warning") return "warn";
  if (rawLevel === "info") return "info";
  if (rawLevel === "debug" || rawLevel === "trace") return "debug";
  if (stream === "ERR") return "error";
  return "unknown";
}

export function parseCfLogLine(raw: string): TCfLogLine {
  const match = raw.match(CF_LOG_LINE);
  if (!match) return { raw, message: raw, level: "unknown" };
  const [, timestamp, source, stream, message] = match;
  const json = tryParseJsonObject(message);
  return { raw, timestamp, source, stream: stream as "OUT" | "ERR", message, json, level: detectLevel(json, stream) };
}

export function parseCfLogs(rawLogs: string): TCfLogLine[] {
  return rawLogs
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map(parseCfLogLine);
}

/** All whitespace-separated terms must appear (case-insensitive) — mirrors highlightMatch's
 * per-term tokenization so a multi-word search narrows down instead of requiring an exact phrase. */
export function matchesLogQuery(line: TCfLogLine, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = line.raw.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const SUMMARY_MAX_LENGTH = 220;

/**
 * A structured JSON payload (this app logs one per HTTP request/background job — commonly 20-50+
 * fields: correlation IDs, every request header, CF routing metadata, etc.) is unreadable dumped
 * inline: it reads as one dense, unbroken wall of text that wraps across a dozen visual lines and
 * makes the timestamp/source columns above/below it impossible to scan. Reduce it to the one line
 * a human actually wants at a glance — level + logger + the human message — and let the full
 * payload live behind a per-line expand (see CfLogViewer) instead of always being on screen.
 */
export function summarizeLogLine(line: TCfLogLine): { summary: string; expandable: boolean } {
  if (line.json) {
    const level = typeof line.json.level === "string" ? `[${line.json.level}]` : undefined;
    const logger = typeof line.json.logger === "string" ? line.json.logger : undefined;
    const msg = typeof line.json.msg === "string" ? line.json.msg : undefined;
    const summary = msg ? [level, logger, msg].filter(Boolean).join(" ") : JSON.stringify(line.json);
    return { summary: summary.length > SUMMARY_MAX_LENGTH ? `${summary.slice(0, SUMMARY_MAX_LENGTH)}…` : summary, expandable: true };
  }
  if (line.message.length > SUMMARY_MAX_LENGTH) {
    return { summary: `${line.message.slice(0, SUMMARY_MAX_LENGTH)}…`, expandable: true };
  }
  return { summary: line.message, expandable: false };
}
