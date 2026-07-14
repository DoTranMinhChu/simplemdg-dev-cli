import { useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { ToolCallDetail } from "../conversation/ToolCallDetail";
import { formatTime } from "../format";
import type { TAiObservation, TErrorGroup } from "../../../api/ai-studio-api-types";

/** §21/§20 — analysis.errorGroups, already computed server-side; click-through to the raw observation. */
export function ErrorsView({ errorGroups, observations, onJumpToTurn }: { errorGroups: TErrorGroup[]; observations: TAiObservation[]; onJumpToTurn: (turnIndex: number) => void }): React.ReactElement {
  const [openKey, setOpenKey] = useState<string | undefined>();

  if (!errorGroups.length) return <EmptyState>No errors observed in this session.</EmptyState>;

  return (
    <div className="errors-view">
      {errorGroups.map((group, index) => {
        const key = `${group.category}-${index}`;
        const open = openKey === key;
        const firstObservation = observations.find((observation) => group.observationIds.includes(observation.id));
        return (
          <div key={key} className="ai-card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: "space-between", cursor: "pointer" }} onClick={() => setOpenKey(open ? undefined : key)}>
              <div>
                <span className="badge err">{group.category}</span>
                <strong style={{ marginLeft: 8 }}>{group.message}</strong>
              </div>
              <span className="note">
                {group.count}x · {formatTime(group.firstOccurredAt)} – {formatTime(group.lastOccurredAt)}
              </span>
            </div>
            {group.affectedTurnIndexes.length ? (
              <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                {group.affectedTurnIndexes.map((turnIndex) => (
                  <button key={turnIndex} type="button" className="chip" onClick={() => onJumpToTurn(turnIndex)}>
                    Turn {turnIndex}
                  </button>
                ))}
              </div>
            ) : null}
            {open && firstObservation ? (
              <div style={{ marginTop: 10 }}>
                <ToolCallDetail observation={firstObservation} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
