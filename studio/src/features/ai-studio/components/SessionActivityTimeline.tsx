import { Icon } from "../../../components/common/Icon";
import type { TAiTurn } from "../../../api/ai-studio-api-types";

function formatClock(iso: string): string {
  const time = new Date(iso);
  return Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Sparkline of tool-call bursts across the session's turns — reuses `turns`, already fetched by
 *  SessionWorkspace for the Turns/Graph tabs, so this needs no extra request. Hidden for
 *  too-short sessions (a bar chart with 0-1 bars isn't a timeline). */
export function SessionActivityTimeline({ turns }: { turns: TAiTurn[] }): React.ReactElement | null {
  const realTurns = turns.filter((turn) => !turn.isContext);
  if (realTurns.length < 2) return null;

  const maxCalls = Math.max(1, ...realTurns.map((turn) => turn.toolCount));

  return (
    <div className="ai-card">
      <h3>
        <Icon name="activity" className="ai-timeline-icon" /> Activity
      </h3>
      <div className="ai-timeline">
        {realTurns.map((turn) => (
          <div
            key={turn.id}
            className="ai-timeline-bar"
            style={{ height: `${Math.max(6, (turn.toolCount / maxCalls) * 100)}%` }}
            title={`Turn ${turn.index + 1} · ${turn.toolCount} tool call${turn.toolCount === 1 ? "" : "s"} · ${formatClock(turn.startedAt)}`}
          />
        ))}
      </div>
      <div className="ai-timeline-range">
        <span>{formatClock(realTurns[0].startedAt)}</span>
        <span>{formatClock(realTurns[realTurns.length - 1].startedAt)}</span>
      </div>
    </div>
  );
}
