import { Icon } from "../common/Icon";
import { Spinner } from "../common/Spinner";

export function SqlToolbar({
  running,
  limit,
  onLimitChange,
  onRun,
  onFormat,
  onSave,
  onExport,
  meta,
}: {
  running: boolean;
  limit: string;
  onLimitChange: (value: string) => void;
  onRun: () => void;
  onFormat: () => void;
  onSave: () => void;
  onExport: (format: "csv" | "json") => void;
  meta?: string;
}): React.ReactElement {
  return (
    <div className="toolbar">
      <button className="btn" disabled={running} onClick={onRun} title="Run (Ctrl+Enter / F5)">
        {running ? <Spinner /> : <Icon name="run" />} {running ? "Running..." : "Run"}
      </button>
      <button className="btn sec" onClick={onFormat}>
        Format
      </button>
      <span className="note">Limit</span>
      <select className="select" style={{ width: "auto" }} value={limit} onChange={(event) => onLimitChange(event.target.value)}>
        {["100", "500", "1000", "5000", "0"].map((value) => (
          <option key={value} value={value}>
            {value === "0" ? "No limit" : value}
          </option>
        ))}
      </select>
      <button className="btn ghost" onClick={onSave} title="Ctrl+S">
        Save
      </button>
      <button className="btn ghost" onClick={() => onExport("csv")}>
        CSV
      </button>
      <button className="btn ghost" onClick={() => onExport("json")}>
        JSON
      </button>
      <span className="grow" />
      <span className="note">{meta}</span>
    </div>
  );
}
