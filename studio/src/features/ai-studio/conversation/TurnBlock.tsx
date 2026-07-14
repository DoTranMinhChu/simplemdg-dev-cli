import { buildTurnTimeline, turnTitle } from "./conversation-model";
import { UserMessageBlock } from "./UserMessageBlock";
import { AssistantMessageBlock } from "./AssistantMessageBlock";
import { ActivityCard } from "./ActivityCard";
import { Button } from "../../../components/common/Button";
import { formatDuration } from "../format";
import type { TFocusMode } from "./conversation-preferences";
import type { TAiObservation, TAiTurn } from "../../../api/ai-studio-api-types";

export function TurnBlock({
  turn,
  observations,
  focusMode,
  onOpenGraph,
  onFileLink,
}: {
  turn: TAiTurn;
  observations: TAiObservation[];
  focusMode: TFocusMode;
  /** Jumps to the Graph tab pre-selected on this turn — omitted for the synthetic "Session context" turn, which has no graph of its own. */
  onOpenGraph?: (turnIndex: number) => void;
  /** Opens a file-reference link from rendered markdown (e.g. "[file.ts:42](src/file.ts#L42)") in VS Code instead of navigating the page. */
  onFileLink?: (path: string, line?: number) => void;
}): React.ReactElement {
  const timeline = buildTurnTimeline(turn, observations);

  return (
    <div className="turn-block">
      <div className="turn-block-head">
        <span className="turn-block-index">{turn.isContext ? "Session context" : `Turn ${turn.index}`}</span>
        <span className="turn-block-title">{turnTitle(turn)}</span>
        {onOpenGraph && !turn.isContext ? (
          <Button size="sm" variant="ghost" onClick={() => onOpenGraph(turn.index)} title="Open this turn's execution graph">
            Graph
          </Button>
        ) : null}
        {turn.errorCount > 0 ? (
          <span className="badge err">
            {turn.errorCount} error{turn.errorCount === 1 ? "" : "s"}
          </span>
        ) : null}
        <span className="note">{formatDuration(turn.durationMs)}</span>
      </div>
      <div className="turn-block-body">
        {timeline.map((block, index) => {
          if (focusMode === "execution" && (block.kind === "user" || block.kind === "assistant")) return null;
          if (focusMode === "conversation" && block.kind === "activity-group") return null;
          if (block.kind === "user") return <UserMessageBlock key={block.observation.id} observation={block.observation} turnIndex={turn.index} onFileLink={onFileLink} />;
          if (block.kind === "assistant") return <AssistantMessageBlock key={block.observation.id} observation={block.observation} onFileLink={onFileLink} />;
          return <ActivityCard key={`activity-${index}`} observations={block.observations} turnIndex={turn.index} onFileLink={onFileLink} />;
        })}
      </div>
    </div>
  );
}
