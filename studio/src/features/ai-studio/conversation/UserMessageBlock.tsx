import { useState } from "react";
import { Markdown, stripMarkdownToPlainText } from "../../../components/common/Markdown";
import { formatTime } from "../format";
import { parseMetadata } from "./conversation-model";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

/**
 * Auto-compaction re-injects a synthetic "this session is being continued..." user message to carry
 * the pre-compaction summary forward (see the `compactBoundary` metadata set in
 * claude-session-provider.ts). Everything before this point has been summarized away and is no
 * longer part of what the model actually sees — rendering it as an ordinary chat bubble buries that
 * fact, so it gets a distinct, collapsed-by-default banner instead, doubling as an answer to
 * "what does the AI currently remember": everything from here down.
 */
function CompactBoundaryBanner({ observation }: { observation: TAiObservation }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const text = observation.input || observation.output;

  return (
    <div id={`compact-boundary-${observation.id}`} className="compact-boundary">
      <div className="compact-boundary-head" onClick={() => setExpanded((prev) => !prev)}>
        <span className="compact-boundary-icon">⟳</span>
        <span>Context compacted here — everything below is what the model currently retains</span>
        <span className="note">{formatTime(observation.startedAt)}</span>
        <button type="button" className="compact-boundary-toggle">
          {expanded ? "Hide summary" : "Show summary"}
        </button>
      </div>
      {expanded ? (
        <div className="compact-boundary-body">
          <Markdown text={text} />
        </div>
      ) : null}
    </div>
  );
}

export function UserMessageBlock({
  observation,
  turnIndex,
  onFileLink,
}: {
  observation: TAiObservation;
  turnIndex: number;
  onFileLink?: (path: string, line?: number) => void;
}): React.ReactElement {
  const [copied, setCopied] = useState<"" | "text" | "md">("");
  if (parseMetadata(observation).compactBoundary === true) return <CompactBoundaryBanner observation={observation} />;

  const text = observation.input || observation.output;

  const copy = (mode: "text" | "md"): void => {
    navigator.clipboard.writeText(mode === "md" ? text : stripMarkdownToPlainText(text));
    setCopied(mode);
    setTimeout(() => setCopied(""), 1200);
  };

  const copyPermalink = (): void => {
    const url = `${location.origin}${location.pathname}${location.search}#turn-${turnIndex}`;
    navigator.clipboard.writeText(url);
  };

  return (
    <div className="msg msg-user">
      <div className="msg-head">
        <span className="msg-role">USER</span>
        <span className="note">{formatTime(observation.startedAt)}</span>
      </div>
      <div className="msg-body">
        <Markdown text={text} onFileLink={onFileLink} />
      </div>
      <div className="msg-actions">
        <button type="button" onClick={() => copy("text")}>
          {copied === "text" ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => copy("md")}>
          {copied === "md" ? "Copied" : "Copy Markdown"}
        </button>
        <button type="button" onClick={copyPermalink}>
          Permalink
        </button>
      </div>
    </div>
  );
}
