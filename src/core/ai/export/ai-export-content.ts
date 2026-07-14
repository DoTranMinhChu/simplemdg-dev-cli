import type { TAiObservation, TAiTurn } from "../ai-types";

export type TExportEntryKind = "user" | "assistant" | "reasoning" | "activity";

export function classifyForExport(observation: TAiObservation): TExportEntryKind {
  if (observation.type === "user" || observation.type === "command") return "user";
  if (observation.type === "assistant") return "assistant";
  if (observation.type === "reasoning") return "reasoning";
  return "activity";
}

/** Same [startedAt, endedAt] time-window bucketing the API routes already use for ?turnIndex=. */
export function groupObservationsByTurn(turns: TAiTurn[], observations: TAiObservation[]): Map<number, TAiObservation[]> {
  const groups = new Map<number, TAiObservation[]>();
  for (const turn of turns) groups.set(turn.index, []);

  for (const observation of observations) {
    const time = Date.parse(observation.startedAt);
    if (!Number.isFinite(time)) continue;
    for (const turn of turns) {
      const start = Date.parse(turn.startedAt);
      const end = turn.endedAt ? Date.parse(turn.endedAt) : start;
      if (Number.isFinite(start) && time >= start && time <= end + 1) {
        groups.get(turn.index)?.push(observation);
        break;
      }
    }
  }

  for (const bucket of groups.values()) bucket.sort((a, b) => a.idx - b.idx);
  return groups;
}

export function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function statusIcon(status: string): string {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  if (status === "partial") return "⚠";
  return "?";
}

export function sanitizeFileName(name: string): string {
  return (name || "session").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}
