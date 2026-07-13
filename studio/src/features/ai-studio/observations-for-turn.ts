import type { TAiObservation, TAiTurn } from "../../api/ai-studio-api-types";

/** Observations belonging to a turn's [startedAt, endedAt] window — the same approximation the backend uses for ?turnIndex=. */
export function observationsForTurn(observations: TAiObservation[], turn: TAiTurn): TAiObservation[] {
  const start = Date.parse(turn.startedAt);
  const end = turn.endedAt ? Date.parse(turn.endedAt) : start;
  if (!Number.isFinite(start)) return [];
  return observations.filter((observation) => {
    const time = Date.parse(observation.startedAt);
    return Number.isFinite(time) && time >= start && time <= end + 1;
  });
}
