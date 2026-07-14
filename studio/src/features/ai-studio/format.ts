export function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

export function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, value))}%`;
}

export function shortSessionId(id: string): string {
  const last = id.split(":").pop() ?? id;
  return last.slice(0, 8);
}

export function shortModelLabel(model: string): string {
  if (!model) return "unknown";
  const stripped = model.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  return stripped || model;
}

/** Shared good/warn/crit bands for a percent-of-limit value — used by both the session card's
 *  context meter and the Advisor's context-health dimension so they never disagree. */
export function contextSeverity(percent: number): "good" | "warn" | "crit" {
  if (percent >= 90) return "crit";
  if (percent >= 50) return "warn";
  return "good";
}
