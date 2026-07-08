import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { useStudioStore } from "../../state/studio-store";

function previewValue(value: unknown): string {
  if (value == null) return "NULL";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export function RowDetailsModal({
  fields,
  row,
  onClose,
  onInspectCell,
}: {
  fields: string[];
  row: Record<string, unknown>;
  onClose: () => void;
  onInspectCell: (field: string) => void;
}): React.ReactElement {
  const { toast } = useStudioStore();

  const copy = (text: string, label: string): void => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}`);
  };

  return (
    <Modal onClose={onClose} width={640}>
      <h3>Row Details</h3>
      <div className="kvs" style={{ maxHeight: "55vh", overflow: "auto" }}>
        {fields.map((field) => (
          <div key={field} style={{ display: "contents" }}>
            <div className="k">{field}</div>
            <div className="crumbs a" style={{ cursor: "pointer", whiteSpace: "pre-wrap", wordBreak: "break-word" }} onClick={() => onInspectCell(field)} title="Click to inspect this cell">
              {previewValue(row[field])}
            </div>
          </div>
        ))}
      </div>
      <div className="row right" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" onClick={() => copy(JSON.stringify(row, null, 2), "row as JSON")}>
          Copy row as JSON
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
