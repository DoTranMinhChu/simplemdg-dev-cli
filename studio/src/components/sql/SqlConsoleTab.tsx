import { useState } from "react";
import { SqlEditor } from "./SqlEditor";
import { SqlToolbar } from "./SqlToolbar";
import { SqlResultGrid } from "./SqlResultGrid";
import { CellValueInspector } from "../data-grid/CellValueInspector";
import { studioApi } from "../../api/studio-api-client";
import { useStudioStore } from "../../state/studio-store";
import { useWorkspaceStore, type TWorkspaceTab } from "../../state/workspace-store";
import type { TDatabaseQueryResult } from "../../api/studio-api-types";

const DANGEROUS = /\b(drop|truncate|alter|grant|revoke)\b/i;

export function SqlConsoleTab({ tab }: { tab: TWorkspaceTab }): React.ReactElement {
  const { activeConnectionId, activeConnection, toast, setStatusBar } = useStudioStore();
  const { updateTab, setTabDirty, layout } = useWorkspaceStore();
  const [sql, setSql] = useState(tab.sql ?? "select * from DUMMY");
  const [limit, setLimit] = useState("100");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<TDatabaseQueryResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [meta, setMeta] = useState("");
  const [inspectorInput, setInspectorInput] = useState<{ value: unknown; columnName: string } | null>(null);

  const connectionId = tab.connectionId || activeConnectionId;

  const onChange = (value: string): void => {
    setSql(value);
    updateTab(tab.id, { sql: value });
    setTabDirty(tab.id, true);
  };

  const run = async (): Promise<void> => {
    if (!connectionId) {
      toast("Select a connection first.", "warn");
      return;
    }
    if (DANGEROUS.test(sql) && !window.confirm(`This statement may modify or drop data:\n\n${sql.slice(0, 160)}\n\nRun anyway?`)) {
      return;
    }

    setRunning(true);
    setStatusBar({ connectionKind: "run", connectionLabel: "Running query..." });
    setError(undefined);

    try {
      const response = await studioApi.runQuery({ connectionId, sql, limit: parseInt(limit, 10) || 0, readOnly: layout.readOnly, confirmDangerous: true });
      setStatusBar({ connectionKind: "ok", connectionLabel: "Connected" });

      if (!response.ok) {
        if ("blocked" in response && response.blocked) {
          setError(`Read-only mode blocks: ${response.safety.matchedKeywords.join(", ")}`);
        } else if ("error" in response) {
          setError(`SQL failed (${activeConnection?.type === "hana" ? "HANA" : "PostgreSQL"})\n${response.error}`);
        }
        return;
      }

      setResult(response.result);
      setMeta(
        `Rows: ${response.result.rowCount}${response.result.affectedRows != null ? ` · Affected: ${response.result.affectedRows}` : ""} · ${response.result.durationMs}ms${response.result.truncated ? " · truncated" : ""}`,
      );
      setStatusBar({ duration: `${response.result.durationMs}ms`, rows: `${response.result.rowCount} rows` });
    } catch (fetchError) {
      setStatusBar({ connectionKind: "ok", connectionLabel: "Connected" });
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setRunning(false);
    }
  };

  const format = async (): Promise<void> => {
    try {
      const response = await studioApi.formatSql(sql);
      onChange(response.sql);
    } catch {
      toast("Could not format SQL.", "warn");
    }
  };

  const save = async (): Promise<void> => {
    const trimmed = sql.trim();
    if (!trimmed) return toast("Nothing to save.", "warn");

    if (tab.queryId) {
      await studioApi.updateSavedQuery(tab.queryId, { name: tab.title.replace(/^SQL: ?/, ""), sql: trimmed });
      setTabDirty(tab.id, false);
      toast("Query updated.");
      return;
    }

    const name = window.prompt("Save query as", `Query ${new Date().toLocaleString()}`);
    if (!name) return;
    const response = await studioApi.saveQuery({ name, sql: trimmed, connectionId, connectionType: activeConnection?.type });
    updateTab(tab.id, { queryId: response.query.id, title: `SQL: ${name}` });
    setTabDirty(tab.id, false);
    toast("Query saved.");
  };

  const exportResult = async (format2: "csv" | "json"): Promise<void> => {
    if (!result?.rows.length) return toast("No result to export.", "warn");
    const fields = result.fields.length ? result.fields : Object.keys(result.rows[0]);
    const response = await fetch(studioApi.exportUrl(format2), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields, rows: result.rows }),
    });
    const blob = await response.blob();
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = format2 === "csv" ? "result.csv" : "result.json";
    anchor.click();
    toast(`Exported ${format2.toUpperCase()}`);
  };

  return (
    <div className="tabpane">
      <SqlToolbar running={running} limit={limit} onLimitChange={setLimit} onRun={run} onFormat={format} onSave={save} onExport={exportResult} meta={meta} />
      <div className="pane-body">
        <SqlEditor value={sql} onChange={onChange} onRunSelected={run} onRunAll={run} onSave={save} />
        {error ? <div className="errbox">{error}</div> : null}
        <div className="note">Result</div>
        <div className="gridwrap">
          <SqlResultGrid result={result} onCellActivate={(_rowIndex, field, value) => setInspectorInput({ value, columnName: field })} />
        </div>
      </div>
      {inspectorInput ? (
        <CellValueInspector
          input={{ connectionId, schema: "", objectName: "(query result)", columnName: inspectorInput.columnName, value: inspectorInput.value, editable: false }}
          onClose={() => setInspectorInput(null)}
        />
      ) : null}
    </div>
  );
}
