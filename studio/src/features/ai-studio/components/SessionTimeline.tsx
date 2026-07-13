import { useMemo, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleTimeString();
}

function formatDuration(ms: number): string {
  if (!ms) return "";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

function clip(text: string, length: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > length ? `${single.slice(0, length)}…` : single;
}

const VERIFICATION_HINT = /\b(tsc|typecheck|build|test|lint|jest|vitest|playwright)\b/i;

export function SessionTimeline({ observations }: { observations: TAiObservation[] }): React.ReactElement {
  const [hideReasoning, setHideReasoning] = useState(false);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [onlyFileChanges, setOnlyFileChanges] = useState(false);

  const filtered = useMemo(() => {
    return observations.filter((observation) => {
      if (hideReasoning && observation.type === "reasoning") return false;
      if (onlyErrors && !observation.isError) return false;
      if (onlyFileChanges && !["tool-call", "shell-command"].includes(observation.type)) return false;
      return true;
    });
  }, [observations, hideReasoning, onlyErrors, onlyFileChanges]);

  return (
    <div>
      <div className="row" style={{ gap: 14, marginBottom: 12, flexWrap: "wrap" }}>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={hideReasoning} onChange={(event) => setHideReasoning(event.target.checked)} /> Hide reasoning
        </label>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={onlyErrors} onChange={(event) => setOnlyErrors(event.target.checked)} /> Only errors
        </label>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={onlyFileChanges} onChange={(event) => setOnlyFileChanges(event.target.checked)} /> Only tool/shell activity
        </label>
      </div>

      {!filtered.length ? (
        <EmptyState>No observations match these filters.</EmptyState>
      ) : (
        <div>
          {filtered.map((observation) => {
            const isVerification = observation.type === "shell-command" && VERIFICATION_HINT.test(observation.input);
            return (
              <div key={observation.id} className={`trow${observation.isError ? " row-err" : ""}`} style={{ alignItems: "flex-start" }}>
                <div className="note" style={{ width: 84, flex: "0 0 auto" }}>
                  {formatTime(observation.startedAt)}
                </div>
                <div className="trow-main">
                  <div className="trow-title">
                    {observation.type === "user" ? "User prompt" : observation.type === "assistant" ? "Assistant" : observation.name}
                    {isVerification ? <span className="badge" style={{ marginLeft: 6 }}>verification</span> : null}
                    {observation.durationMs ? <span className="note"> · {formatDuration(observation.durationMs)}</span> : null}
                  </div>
                  {observation.input ? <div className="note">{clip(observation.input, 200)}</div> : null}
                  {observation.output ? <div className="note">{clip(observation.output, 200)}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
