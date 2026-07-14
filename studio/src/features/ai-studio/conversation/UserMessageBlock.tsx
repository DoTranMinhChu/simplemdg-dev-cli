import { useState } from "react";
import { Markdown, stripMarkdownToPlainText } from "../../../components/common/Markdown";
import { formatTime } from "../format";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

export function UserMessageBlock({
  observation,
  turnIndex,
  onFileLink,
}: {
  observation: TAiObservation;
  turnIndex: number;
  onFileLink?: (path: string, line?: number) => void;
}): React.ReactElement {
  const text = observation.input || observation.output;
  const [copied, setCopied] = useState<"" | "text" | "md">("");

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
