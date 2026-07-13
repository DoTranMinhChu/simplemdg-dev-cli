import { useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import type { TAiObservation, TAiTurn } from "../../../api/ai-studio-api-types";

function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function clip(text: string, length: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > length ? `${single.slice(0, length)}…` : single;
}

/** Observations belonging to a turn's [startedAt, endedAt] window — the same approximation the backend uses for ?turnIndex=. */
function observationsForTurn(observations: TAiObservation[], turn: TAiTurn): TAiObservation[] {
  const start = Date.parse(turn.startedAt);
  const end = turn.endedAt ? Date.parse(turn.endedAt) : start;
  if (!Number.isFinite(start)) return [];
  return observations.filter((observation) => {
    const time = Date.parse(observation.startedAt);
    return Number.isFinite(time) && time >= start && time <= end + 1;
  });
}

function typeIcon(observation: TAiObservation): string {
  const icons: Record<string, string> = {
    user: "👤",
    assistant: "💬",
    reasoning: "🧠",
    "tool-call": "🔧",
    "shell-command": "▶",
    "mcp-call": "🔌",
    skill: "✨",
    subagent: "🤖",
    command: "⌘",
    error: "⚠",
  };
  return icons[observation.type] ?? "•";
}

function ObservationRow({ observation }: { observation: TAiObservation }): React.ReactElement {
  return (
    <div className={`trow${observation.isError ? " row-err" : ""}`} style={{ cursor: "default" }}>
      <div className="trow-icon">{typeIcon(observation)}</div>
      <div className="trow-main">
        <div className="trow-title">
          {observation.name}
          {observation.durationMs ? <span className="note"> · {formatDuration(observation.durationMs)}</span> : null}
          {observation.tokens ? <span className="note"> · {observation.tokens} tok</span> : null}
        </div>
        {observation.input ? <div className="note">{clip(observation.input, 160)}</div> : null}
        {observation.output ? <div className="note">{clip(observation.output, 160)}</div> : null}
      </div>
    </div>
  );
}

function TurnRow({ turn, observations }: { turn: TAiTurn; observations: TAiObservation[] }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const turnObservations = observationsForTurn(observations, turn);

  return (
    <div className="tnode" style={{ marginBottom: 10 }}>
      <div className="trow" onClick={() => setExpanded((prev) => !prev)}>
        <span className={`tchev${expanded ? " open" : ""}`}>&rsaquo;</span>
        <div className="trow-main">
          <div className="trow-title">
            {turn.isContext ? "Session context" : `Turn ${turn.index}`}
            {turn.errorCount > 0 ? <span style={{ color: "var(--red)" }}> · {turn.errorCount} errors</span> : null}
          </div>
          <div className="note">{clip(turn.userRequest, 140)}</div>
          <div className="note">
            {formatDuration(turn.durationMs)} · {turn.outputTokens.toLocaleString()} tok · {turn.toolCount} tools
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="tchildren">
          {turnObservations.length ? turnObservations.map((observation) => <ObservationRow key={observation.id} observation={observation} />) : <div className="tnote">No observations.</div>}
        </div>
      ) : null}
    </div>
  );
}

export function TurnList({ turns, observations }: { turns: TAiTurn[]; observations: TAiObservation[] }): React.ReactElement {
  if (!turns.length) return <EmptyState>No turns recorded.</EmptyState>;

  return (
    <div>
      {turns.map((turn) => (
        <TurnRow key={turn.id} turn={turn} observations={observations} />
      ))}
    </div>
  );
}
