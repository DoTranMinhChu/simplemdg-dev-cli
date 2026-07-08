import { useEffect, useState } from "react";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { studioApi } from "../../api/studio-api-client";
import { useWorkspaceStore, type TWorkspaceTab } from "../../state/workspace-store";
import { useStudioStore } from "../../state/studio-store";
import type { TDatabaseColumn, TDatabaseIndex } from "../../api/studio-api-types";

type TSubTab = "columns" | "indexes" | "ddl" | "info";
const SUB_TABS: Array<[TSubTab, string]> = [
  ["columns", "Columns"],
  ["indexes", "Indexes"],
  ["ddl", "DDL"],
  ["info", "Info"],
];

export function StructureTab({ tab }: { tab: TWorkspaceTab }): React.ReactElement {
  const { toast, activeConnectionId } = useStudioStore();
  const { openTab } = useWorkspaceStore();
  const connectionId = tab.connectionId || activeConnectionId;
  const schema = tab.schema ?? "";
  const table = tab.objectName ?? "";

  const [sub, setSub] = useState<TSubTab>("columns");
  const [columns, setColumns] = useState<TDatabaseColumn[] | null>(null);
  const [indexes, setIndexes] = useState<TDatabaseIndex[] | null>(null);
  const [primaryKey, setPrimaryKey] = useState<string[]>([]);
  const [ddl, setDdl] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setError(undefined);
    if (sub === "columns" && columns == null) {
      setLoading(true);
      studioApi
        .getColumns(connectionId, schema, table)
        .then((response) => {
          if (response.error) setError(response.error);
          else setColumns(response.columns ?? []);
        })
        .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
        .finally(() => setLoading(false));
    } else if (sub === "indexes" && indexes == null) {
      setLoading(true);
      studioApi
        .getConstraints(connectionId, schema, table)
        .then((response) => {
          setPrimaryKey(response.primaryKey?.columns ?? []);
          setIndexes(response.indexes ?? []);
        })
        .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
        .finally(() => setLoading(false));
    } else if (sub === "ddl" && ddl == null) {
      setLoading(true);
      studioApi
        .getDdl(connectionId, schema, table)
        .then((response) => setDdl(response.ddl))
        .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
        .finally(() => setLoading(false));
    } else if (sub === "info" && rowCount == null) {
      setLoading(true);
      studioApi
        .getTableCount(connectionId, schema, table)
        .then((response) => setRowCount(response.count))
        .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub]);

  return (
    <div className="tabpane">
      <div className="crumbs">
        <span>{schema}</span>
        <span className="sep">›</span>
        <span>{table}</span>
      </div>
      <div className="toolbar">
        <b>
          &quot;{schema}&quot;.&quot;{table}&quot;
        </b>
        <span className="grow" />
        <Button
          size="sm"
          variant="sec"
          onClick={() =>
            openTab({ key: `data:${connectionId}:${schema}.${table}`, kind: "data-grid", title: table, connectionId, schema, objectName: table, objectType: tab.objectType })
          }
        >
          Open Data
        </Button>
      </div>
      <div className="meta-tabs">
        {SUB_TABS.map(([key, label]) => (
          <div key={key} className={`meta-tab${sub === key ? " active" : ""}`} onClick={() => setSub(key)}>
            {label}
          </div>
        ))}
      </div>
      <div className="pane-body">
        {loading ? (
          <EmptyState>
            <span className="spin" /> loading...
          </EmptyState>
        ) : error ? (
          <div className="errbox">{error}</div>
        ) : sub === "columns" ? (
          renderColumns()
        ) : sub === "indexes" ? (
          renderIndexes()
        ) : sub === "ddl" ? (
          renderDdl()
        ) : (
          renderInfo()
        )}
      </div>
    </div>
  );

  function renderColumns(): React.ReactElement {
    if (!columns?.length) return <EmptyState>No columns.</EmptyState>;
    return (
      <table className="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Length</th>
            <th>Scale</th>
            <th>Nullable</th>
            <th>Key</th>
            <th>Default</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.name}>
              <td>{column.name}</td>
              <td>{column.dataType}</td>
              <td className="num">{column.length ?? ""}</td>
              <td className="num">{column.scale ?? ""}</td>
              <td>{column.nullable ? "YES" : "NO"}</td>
              <td>{column.isPrimaryKey ? <span className="pill pk">PK</span> : ""}</td>
              <td>{column.defaultValue ?? ""}</td>
              <td>{column.comment ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderIndexes(): React.ReactElement {
    return (
      <>
        <div className="kvs">
          <div className="k">Primary key</div>
          <div>{primaryKey.length ? primaryKey.join(", ") : "(none)"}</div>
        </div>
        {!indexes?.length ? (
          <EmptyState>No indexes.</EmptyState>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th>Index</th>
                <th>Columns</th>
                <th>Unique</th>
                <th>Primary</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((index) => (
                <tr key={index.name}>
                  <td>{index.name}</td>
                  <td>{index.columns.join(", ")}</td>
                  <td>{index.isUnique ? "YES" : "NO"}</td>
                  <td>{index.isPrimaryKey ? "YES" : "NO"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </>
    );
  }

  function renderDdl(): React.ReactElement {
    return (
      <>
        <div className="row" style={{ marginBottom: 8 }}>
          <Button
            size="sm"
            variant="sec"
            onClick={() => openTab({ key: `sql:${Date.now()}`, kind: "sql", title: table, connectionId, sql: ddl ?? "" })}
          >
            Open in SQL Console
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(ddl ?? "");
              toast("Copied DDL");
            }}
          >
            Copy
          </Button>
        </div>
        <textarea className="editor" readOnly style={{ minHeight: 320, width: "100%" }} value={ddl ?? ""} />
      </>
    );
  }

  function renderInfo(): React.ReactElement {
    return (
      <div className="kvs">
        <div className="k">Schema</div>
        <div>{schema}</div>
        <div className="k">Object</div>
        <div>{table}</div>
        <div className="k">Row count</div>
        <div>{rowCount ?? "-"}</div>
        <div className="k">Columns</div>
        <div>{columns?.length ?? "-"}</div>
      </div>
    );
  }
}
