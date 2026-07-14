import { useState } from "react";
import { Markdown, stripMarkdownToPlainText } from "../../../components/common/Markdown";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { formatTime } from "../format";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

export function AssistantMessageBlock({ observation }: { observation: TAiObservation }): React.ReactElement {
  const text = observation.output;
  const [copied, setCopied] = useState<"" | "text" | "md">("");
  const [showRaw, setShowRaw] = useState(false);

  const copy = (mode: "text" | "md"): void => {
    navigator.clipboard.writeText(mode === "md" ? text : stripMarkdownToPlainText(text));
    setCopied(mode);
    setTimeout(() => setCopied(""), 1200);
  };

  return (
    <div className="msg msg-assistant">
      <div className="msg-head">
        <span className="msg-role">AI</span>
        <span className="note">{formatTime(observation.startedAt)}</span>
      </div>
      <div className="msg-body">
        <Markdown text={text} />
      </div>
      <div className="msg-actions">
        <button type="button" onClick={() => copy("text")}>
          {copied === "text" ? "Copied" : "Copy rendered text"}
        </button>
        <button type="button" onClick={() => copy("md")}>
          {copied === "md" ? "Copied" : "Copy Markdown"}
        </button>
        <button type="button" onClick={() => setShowRaw(true)}>
          Open raw
        </button>
      </div>
      {showRaw ? (
        <Modal onClose={() => setShowRaw(false)} width={800}>
          <h3>Raw response</h3>
          <pre className="cell-pre wrap">{text}</pre>
          <div className="row right" style={{ marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setShowRaw(false)}>
              Close
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
