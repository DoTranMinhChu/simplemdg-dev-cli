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

/** epoch ms, or undefined if the line has no timestamp or it doesn't parse (never filtered out by
 * a time range in that case — an unparseable timestamp shouldn't silently hide a line). */
export function parseLineTimestampMs(line: TCfLogLine): number | undefined {
  if (!line.timestamp) return undefined;
  const parsed = Date.parse(line.timestamp);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function withinTimeRange(line: TCfLogLine, fromMs: number | undefined, toMs: number | undefined): boolean {
  if (fromMs === undefined && toMs === undefined) return true;
  const ts = parseLineTimestampMs(line);
  if (ts === undefined) return true;
  if (fromMs !== undefined && ts < fromMs) return false;
  if (toMs !== undefined && ts > toMs) return false;
  return true;
}

/**
 * A structured JSON payload (this app logs one per HTTP request/background job — commonly 20-50+
 * fields: correlation IDs, every request header, CF routing metadata, etc.) is unreadable dumped
 * inline as raw JSON: it reads as one dense wall of key:value pairs with no visual hierarchy.
 * Reduce it to the line a human actually wants at a glance — level + logger + the human message —
 * with the full payload available as a proper collapsible tree behind a click (see CfLogViewer)
 * instead of a JSON blob always on screen. This is a content transform, not truncation: the summary
 * itself is never character-clipped, and CfLogViewer wraps it in full rather than ellipsis-cutting
 * it, so nothing is ever hidden without the user explicitly asking for the tree view.
 */
export function summarizeLogLine(line: TCfLogLine): { summary: string; expandable: boolean } {
  if (line.json) {
    const level = typeof line.json.level === "string" ? `[${line.json.level}]` : undefined;
    const logger = typeof line.json.logger === "string" ? line.json.logger : undefined;
    const msg = typeof line.json.msg === "string" ? line.json.msg : undefined;
    const summary = msg ? [level, logger, msg].filter(Boolean).join(" ") : JSON.stringify(line.json);
    return { summary, expandable: true };
  }
  return { summary: line.message, expandable: false };
}
