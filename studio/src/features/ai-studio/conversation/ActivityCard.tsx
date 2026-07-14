import { useState } from "react";
import { formatDuration } from "../format";
import { observationTypeIcon } from "../observation-icon";
import { deriveConversationKind, isVerificationObservation, summarizeActivity } from "./conversation-model";
import { ToolCallDetail } from "./ToolCallDetail";
import { ReasoningBlock } from "./ReasoningBlock";
import { ShellCommandCard } from "./ShellCommandCard";
import { FileActivityCard } from "./FileActivityCard";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

function ToolActivityRow({ observation }: { observation: TAiObservation }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const kind = deriveConversationKind(observation);
  return (
    <div className={`activity-row${observation.isError ? " row-err" : ""}`}>
      <div className="activity-row-head" onClick={() => setOpen((prev) => !prev)}>
        <span className="activity-row-icon">{observationTypeIcon(kind)}</span>
        <span className="activity-row-name">{observation.name}</span>
        {isVerificationObservation(observation) ? <span className="badge">verification</span> : null}
        {observation.durationMs ? <span className="note">{formatDuration(observation.durationMs)}</span> : null}
        <span className={`tchev${open ? " open" : ""}`}>&rsaquo;</span>
      </div>
      {open ? (
        <div className="activity-row-detail">
          <ToolCallDetail observation={observation} />
        </div>
      ) : null}
    </div>
  );
}

/** §11 — collapsed "AI ACTIVITY" summary card that expands into one row per observation in the group. */
export function ActivityCard({ observations, turnIndex }: { observations: TAiObservation[]; turnIndex: number }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeActivity(observations);

  const parts: string[] = [];
  if (summary.toolCallCount) parts.push(`${summary.toolCallCount} tool call${summary.toolCallCount === 1 ? "" : "s"}`);
  if (summary.filesReadCount) parts.push(`${summary.filesReadCount} file${summary.filesReadCount === 1 ? "" : "s"} read`);
  if (summary.filesEditedCount) parts.push(`${summary.filesEditedCount} file${summary.filesEditedCount === 1 ? "" : "s"} edited`);
  if (summary.shellCommandCount) parts.push(`${summary.shellCommandCount} shell command${summary.shellCommandCount === 1 ? "" : "s"}`);
  if (summary.errorCount) parts.push(`${summary.errorCount} error${summary.errorCount === 1 ? "" : "s"}`);

  return (
    <div className="activity-card">
      <div className="activity-card-head" onClick={() => setExpanded((prev) => !prev)}>
        <span className="activity-card-label">AI ACTIVITY</span>
        <span className="activity-card-summary">{parts.join(" · ") || "Activity"}</span>
        <span className="note">Duration: {formatDuration(summary.totalDurationMs)}</span>
        <button type="button" className="activity-card-toggle">
          {expanded ? "Collapse activity" : "Expand activity"}
        </button>
      </div>
      {expanded ? (
        <div className="activity-card-body">
          {observations.map((observation) => {
            const kind = deriveConversationKind(observation);
            if (kind === "reasoning") return <ReasoningBlock key={observation.id} observation={observation} />;
            if (kind === "shell-command") return <ShellCommandCard key={observation.id} observation={observation} compact />;
            if (kind === "file-read" || kind === "file-write" || kind === "file-edit") {
              return <FileActivityCard key={observation.id} observation={observation} turnIndex={turnIndex} />;
            }
            return <ToolActivityRow key={observation.id} observation={observation} />;
          })}
        </div>
      ) : null}
    </div>
  );
}
