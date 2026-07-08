import { useState } from "react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { detectCellValue, sanitizeHtml, sqlLiteral } from "./cell-value-detection";
import { useStudioStore } from "../../state/studio-store";

export type TCellInspectorInput = {
  connectionId: string;
  schema: string;
  objectName: string;
  objectType?: "table" | "view";
  columnName: string;
  sqlDataType?: string;
  value: unknown;
  primaryKey?: Record<string, unknown>;
  editable?: boolean;
  onApplyEdit?: (newValue: string) => void;
  disabledReason?: string;
};

type TTab = "preview" | "formatted" | "raw" | "edit" | "metadata";

export function CellValueInspector({ input, onClose }: { input: TCellInspectorInput; onClose: () => void }): React.ReactElement {
  const { toast } = useStudioStore();
  const detected = detectCellValue(input.value);
  const [tab, setTab] = useState<TTab>("preview");
  const [editValue, setEditValue] = useState(detected.stringValue);

  const displayText = detected.formattedValue ?? detected.stringValue;

  return (
    <Modal onClose={onClose} width={760}>
      <div className="cell-inspector">
        <div className="cell-head">
          <div className="cell-title">
            <span>Cell Value Inspector</span>
            <span className={`cell-kind ${detected.kind}`}>
              {detected.kind.toUpperCase()} · {Math.round(detected.confidence * 100)}%
            </span>
          </div>
          <div className="cell-sub">
            {input.objectName} · {input.columnName} · {input.sqlDataType ?? detected.kind.toUpperCase()}
            {detected.metadata.length != null ? ` · ${detected.metadata.length.toLocaleString()} chars` : ""}
          </div>
        </div>

        <div className="cell-tabs">
          {(["preview", "formatted", "raw", "edit", "metadata"] as TTab[]).map((item) => (
            <div key={item} className={`cell-tab${tab === item ? " active" : ""}`} onClick={() => setTab(item)}>
              {item[0].toUpperCase() + item.slice(1)}
            </div>
          ))}
        </div>

        <div className="cell-body">
          {tab === "preview" && renderPreview()}
          {tab === "formatted" && <pre className="cell-pre wrap">{displayText}</pre>}
          {tab === "raw" && <pre className="cell-pre wrap">{detected.stringValue}</pre>}
          {tab === "edit" && renderEdit()}
          {tab === "metadata" && renderMetadata()}
        </div>

        <div className="row right" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>
          <Button size="sm" variant="ghost" onClick={() => copy(detected.stringValue, "raw")}>
            Copy raw
          </Button>
          <Button size="sm" variant="ghost" onClick={() => copy(displayText, "formatted")}>
            Copy formatted
          </Button>
          <Button size="sm" variant="ghost" onClick={() => copy(sqlLiteral(input.value), "SQL literal")}>
            Copy SQL literal
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );

  function copy(text: string, label: string): void {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}`);
  }

  function renderPreview(): React.ReactElement {
    if (detected.kind === "null") return <div className="cell-null">NULL</div>;
    if (detected.kind === "boolean") return <span className={`cell-bool ${String(detected.rawValue).toLowerCase()}`}>{detected.stringValue.toUpperCase()}</span>;
    if (detected.kind === "number") return <div className="cell-num-big">{detected.formattedValue ?? detected.stringValue}</div>;
    if (detected.kind === "date" || detected.kind === "datetime") {
      const date = new Date(detected.stringValue);
      return (
        <div className="kvs">
          <div className="k">Raw</div>
          <div>{detected.stringValue}</div>
          <div className="k">Local</div>
          <div>{date.toLocaleString()}</div>
          <div className="k">UTC</div>
          <div>{date.toUTCString()}</div>
        </div>
      );
    }
    if (detected.kind === "url") {
      return (
        <a className="crumbs a" href={detected.stringValue} target="_blank" rel="noopener noreferrer">
          {detected.stringValue}
        </a>
      );
    }
    if (detected.kind === "html") {
      return (
        <>
          <div className="note">HTML preview is sanitized (scripts, event handlers, and javascript: URLs removed).</div>
          <iframe className="cell-iframe" sandbox="" srcDoc={sanitizeHtml(displayText)} title="HTML preview" />
        </>
      );
    }
    return <pre className="cell-pre wrap">{displayText}</pre>;
  }

  function renderEdit(): React.ReactElement {
    if (!input.editable) {
      return <div className="errbox">{input.disabledReason ?? "Editing is not available for this cell."}</div>;
    }
    return (
      <>
        <div className="note" style={{ marginBottom: 6 }}>
          Applies to pending grid changes. The cell turns yellow; use Save Changes to persist.
        </div>
        <textarea className="editor" style={{ minHeight: 260, width: "100%" }} value={editValue} onChange={(event) => setEditValue(event.target.value)} />
        <div className="row right" style={{ marginTop: 8 }}>
          <Button
            onClick={() => {
              input.onApplyEdit?.(editValue);
              toast("Applied to pending changes.");
              onClose();
            }}
          >
            Apply to grid
          </Button>
        </div>
      </>
    );
  }

  function renderMetadata(): React.ReactElement {
    const rows: Array<[string, string]> = [
      ["Schema", input.schema],
      ["Object", input.objectName],
      ["Column", input.columnName],
      ["SQL type", input.sqlDataType ?? "(unknown)"],
      ["Primary key", input.primaryKey ? Object.keys(input.primaryKey).join(", ") || "(none)" : "(none)"],
      ["Detected kind", detected.kind],
      ["Confidence", `${Math.round(detected.confidence * 100)}%`],
      ["Raw length", String(detected.metadata.length ?? detected.stringValue.length)],
      ["Line count", String(detected.metadata.lineCount ?? 1)],
    ];
    return (
      <div className="kvs">
        {rows.map(([key, value]) => (
          <div key={key} style={{ display: "contents" }}>
            <div className="k">{key}</div>
            <div>{value}</div>
          </div>
        ))}
      </div>
    );
  }
}
