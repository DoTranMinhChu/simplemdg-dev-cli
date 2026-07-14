import { useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { formatDuration, formatTime } from "../format";
import { observationTypeIcon } from "../observation-icon";
import { deriveConversationKind, isVerificationObservation, type TConversationEntryKind } from "../conversation/conversation-model";
import { ToolCallDetail } from "../conversation/ToolCallDetail";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

type TExecutionFilter = "all" | "agent" | "tools" | "files" | "commands" | "errors" | "verification" | "subagents";

const FILTERS: Array<{ key: TExecutionFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "agent", label: "Agent" },
  { key: "tools", label: "Tools" },
  { key: "files", label: "Files" },
  { key: "commands", label: "Commands" },
  { key: "errors", label: "Errors" },
  { key: "verification", label: "Verification" },
  { key: "subagents", label: "Subagents" },
];

function matchesFilter(observation: TAiObservation, kind: TConversationEntryKind, filter: TExecutionFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "agent":
      return kind === "assistant-message" || kind === "reasoning";
    case "tools":
      return kind === "tool-call" || kind === "skill";
    case "files":
      return kind === "file-read" || kind === "file-write" || kind === "file-edit";
    case "commands":
      return kind === "shell-command";
    case "errors":
      return observation.isError;
    case "verification":
      return isVerificationObservation(observation);
    case "subagents":
      return kind === "subagent";
    default:
      return true;
  }
}

/** §21 — advanced technical view: chronological events + filters + a detail drawer. Leaves the existing Timeline tab untouched. */
export function ExecutionView({ observations }: { observations: TAiObservation[] }): React.ReactElement {
  const [filter, setFilter] = useState<TExecutionFilter>("all");
  const [selectedId, setSelectedId] = useState<string | undefined>();

  const filtered = observations.filter((observation) => matchesFilter(observation, deriveConversationKind(observation), filter));
  const selected = observations.find((observation) => observation.id === selectedId);

  if (!observations.length) return <EmptyState>No execution events recorded.</EmptyState>;

  return (
    <div className={`execution-view${selected ? " with-drawer" : ""}`}>
      <div className="execution-main">
        <div className="execution-filters">
          {FILTERS.map((entry) => (
            <button key={entry.key} type="button" className={`chip${filter === entry.key ? " active" : ""}`} onClick={() => setFilter(entry.key)}>
              {entry.label}
            </button>
          ))}
        </div>
        <div className="execution-list">
          {filtered.map((observation) => {
            const kind = deriveConversationKind(observation);
            return (
              <div
                key={observation.id}
                className={`trow execution-row${observation.isError ? " row-err" : ""}${observation.id === selectedId ? " active" : ""}`}
                onClick={() => setSelectedId(observation.id)}
              >
                <div className="note" style={{ width: 84, flex: "0 0 auto" }}>
                  {formatTime(observation.startedAt)}
                </div>
                <div className="trow-icon">{observationTypeIcon(kind)}</div>
                <div className="trow-main">
                  <div className="trow-title">
                    {observation.name}
                    {isVerificationObservation(observation) ? <span className="badge">verification</span> : null}
                    {observation.durationMs ? <span className="note"> · {formatDuration(observation.durationMs)}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
          {!filtered.length ? <EmptyState>No events match this filter.</EmptyState> : null}
        </div>
      </div>
      {selected ? (
        <div className="execution-drawer">
          <div className="execution-drawer-head">
            <strong>{selected.name}</strong>
            <button type="button" onClick={() => setSelectedId(undefined)}>
              Close
            </button>
          </div>
          <ToolCallDetail observation={selected} />
        </div>
      ) : null}
    </div>
  );
}
