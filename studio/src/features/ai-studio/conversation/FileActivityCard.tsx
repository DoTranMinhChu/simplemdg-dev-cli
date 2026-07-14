import { useState } from "react";
import { CodeBlock } from "../../../components/common/CodeBlock";
import { deriveConversationKind, extractFilePath } from "./conversation-model";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

function parseInputJson(observation: TAiObservation): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(observation.input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * §14 — compact inline "FILE EDITED/READ/CREATED" card. "View diff" is a lightweight before/after
 * text comparison built from the tool's own old_string/new_string (Edit) or content (Write) input —
 * not a real line-diff algorithm, no diff dependency added for this phase.
 */
export function FileActivityCard({
  observation,
  turnIndex,
  onJumpToTurn,
}: {
  observation: TAiObservation;
  turnIndex?: number;
  onJumpToTurn?: (turnIndex: number) => void;
}): React.ReactElement {
  const [showDiff, setShowDiff] = useState(false);
  const kind = deriveConversationKind(observation);
  const path = extractFilePath(observation) || observation.name;
  const label = kind === "file-read" ? "FILE READ" : kind === "file-write" ? "FILE CREATED" : "FILE EDITED";
  const data = parseInputJson(observation);

  const copyPath = (): void => {
    navigator.clipboard.writeText(path);
  };

  return (
    <div className={`filecard${observation.isError ? " row-err" : ""}`}>
      <div className="filecard-head">
        <span className="filecard-label">{label}</span>
        <code className="filecard-path">{path}</code>
        {turnIndex !== undefined ? <span className="note">Turn {turnIndex}</span> : null}
      </div>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {kind !== "file-read" ? (
          <button type="button" onClick={() => setShowDiff((prev) => !prev)}>
            {showDiff ? "Hide diff" : "View diff"}
          </button>
        ) : null}
        {onJumpToTurn && turnIndex !== undefined ? (
          <button type="button" onClick={() => onJumpToTurn(turnIndex)}>
            Open related activity
          </button>
        ) : null}
        <button type="button" onClick={copyPath}>
          Copy path
        </button>
      </div>
      {showDiff ? (
        <div className="filecard-diff">
          {typeof data.old_string === "string" && typeof data.new_string === "string" ? (
            <>
              <div className="note">Before</div>
              <CodeBlock code={String(data.old_string)} language="text" />
              <div className="note">After</div>
              <CodeBlock code={String(data.new_string)} language="text" />
            </>
          ) : typeof data.content === "string" ? (
            <CodeBlock code={String(data.content)} language="text" />
          ) : (
            <div className="note">No before/after content available for this tool call.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
