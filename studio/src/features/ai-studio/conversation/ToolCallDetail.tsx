import { useState } from "react";
import { formatDuration, formatTime } from "../format";
import { JsonOrText, JsonView } from "../../../components/common/JsonView";
import { parseMetadata } from "./conversation-model";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

type TPane = "summary" | "input" | "output" | "metadata" | "raw";

/** Summary/Input/Output/Metadata/Raw detail for one observation — the shared escape hatch used by
 *  the Conversation tab's activity rows and the Execution tab's detail drawer. */
export function ToolCallDetail({ observation }: { observation: TAiObservation }): React.ReactElement {
  const metadata = parseMetadata(observation);
  const hasMetadata = Object.keys(metadata).length > 0;
  const panes: Array<{ key: TPane; label: string }> = [
    { key: "summary", label: "Summary" },
    { key: "input", label: "Input" },
    { key: "output", label: "Output" },
    ...(hasMetadata ? ([{ key: "metadata", label: "Metadata" }] as const) : []),
    { key: "raw", label: "Raw" },
  ];
  const [pane, setPane] = useState<TPane>("summary");

  return (
    <div className="tooldetail">
      <div className="tooldetail-tabs">
        {panes.map((entry) => (
          <button key={entry.key} type="button" className={`tooldetail-tab${pane === entry.key ? " active" : ""}`} onClick={() => setPane(entry.key)}>
            {entry.label}
          </button>
        ))}
      </div>
      <div className="tooldetail-body">
        {pane === "summary" ? (
          <div className="kvs">
            <div className="k">Tool</div>
            <div>{observation.name}</div>
            <div className="k">Started</div>
            <div>{formatTime(observation.startedAt)}</div>
            <div className="k">Duration</div>
            <div>{formatDuration(observation.durationMs)}</div>
            <div className="k">Status</div>
            <div>{observation.isError ? "Error" : "Success"}</div>
            {observation.tokens ? (
              <>
                <div className="k">Tokens</div>
                <div>{observation.tokens}</div>
              </>
            ) : null}
          </div>
        ) : pane === "input" ? (
          observation.input ? <JsonOrText text={observation.input} language="json" /> : <div className="note">No input recorded.</div>
        ) : pane === "output" ? (
          observation.output ? <JsonOrText text={observation.output} /> : <div className="note">No output recorded.</div>
        ) : pane === "metadata" ? (
          <JsonView value={metadata} />
        ) : (
          <JsonOrText text={JSON.stringify(observation, null, 2)} language="json" />
        )}
      </div>
    </div>
  );
}
