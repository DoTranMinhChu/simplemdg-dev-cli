import { useState } from "react";
import { formatDuration } from "../format";
import { CodeBlock } from "../../../components/common/CodeBlock";
import { highlightMatch } from "../../../lib/highlight-match";
import { isVerificationObservation } from "./conversation-model";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

/** §13 — full command presentation (also used, compact, inside a turn's activity card). */
export function ShellCommandCard({ observation, compact, cwd }: { observation: TAiObservation; compact?: boolean; cwd?: string }): React.ReactElement {
  const [expanded, setExpanded] = useState(!compact);
  const [outputExpanded, setOutputExpanded] = useState(observation.output.length < 800);
  const [outputFilter, setOutputFilter] = useState("");

  const status = observation.isError ? "FAIL" : isVerificationObservation(observation) ? "PASS" : observation.output ? "DONE" : "UNKNOWN";
  const commandLine = observation.input.trim().split(/\r?\n/)[0] || observation.input.trim();

  const copyCommand = (): void => {
    navigator.clipboard.writeText(observation.input);
  };

  const downloadLog = (): void => {
    const blob = new Blob([observation.output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "command-output.log";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`shellcard${observation.isError ? " row-err" : ""}`}>
      <div className="shellcard-head" onClick={() => compact && setExpanded((prev) => !prev)}>
        <span className="shellcard-label">COMMAND</span>
        <code className="shellcard-command">{commandLine}</code>
        {observation.durationMs ? <span className="note">{formatDuration(observation.durationMs)}</span> : null}
        <span className={`badge${status === "FAIL" ? " err" : status === "PASS" || status === "DONE" ? " on" : ""}`}>{status}</span>
        {compact ? <span className={`tchev${expanded ? " open" : ""}`}>&rsaquo;</span> : null}
      </div>
      {expanded ? (
        <div className="shellcard-body">
          {cwd ? <div className="note">Working directory: {cwd}</div> : null}
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={copyCommand}>
              Copy command
            </button>
            <button type="button" onClick={downloadLog} disabled={!observation.output}>
              Download log
            </button>
            {observation.output ? (
              <button type="button" onClick={() => setOutputExpanded((prev) => !prev)}>
                {outputExpanded ? "Collapse output" : "Show output"}
              </button>
            ) : null}
          </div>
          {outputExpanded && observation.output ? (
            <>
              <input className="shellcard-search" placeholder="Search output…" value={outputFilter} onChange={(event) => setOutputFilter(event.target.value)} />
              {outputFilter.trim() ? (
                <pre className="shellcard-output-plain">{highlightMatch(observation.output, outputFilter.trim())}</pre>
              ) : (
                <CodeBlock code={observation.output} language="text" />
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
