import { useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TAuditLogDefinition, TAuditLogEnvironment, TAuditLogTraceRow } from "../api/tool-studio-api-client";

function rowTimestamp(row: TAuditLogTraceRow): string {
  if (row.timestampColumn && row.row[row.timestampColumn] !== undefined) return String(row.row[row.timestampColumn]);
  return "";
}

function TraceRowCard({ row }: { row: TAuditLogTraceRow }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const timestamp = rowTimestamp(row);
  return (
    <div className="ts-card" style={{ padding: "var(--space-3)", marginBottom: 8 }}>
      <div className="row" style={{ alignItems: "baseline", cursor: "pointer" }} onClick={() => setExpanded((prev) => !prev)}>
        <b style={{ flex: 1 }}>{row.displayName}</b>
        <span className="note">{row.envLabel}</span>
      </div>
      <div className="note">
        {row.schema}.{row.table}
        {timestamp ? ` · ${timestamp}` : ""}
      </div>
      {expanded && <pre className="cell-pre" style={{ marginTop: 8, maxHeight: 300, overflow: "auto" }}>{JSON.stringify(row.row, null, 2)}</pre>}
    </div>
  );
}

export function AuditLogTraceTab({
  environments,
  catalog,
  selectedEnvironmentIds,
  onChangeSelection,
}: {
  environments: TAuditLogEnvironment[];
  catalog: TAuditLogDefinition[];
  selectedEnvironmentIds: string[];
  onChangeSelection: (ids: string[]) => void;
}): React.ReactElement {
  const [correlationColumn, setCorrelationColumn] = useState("reqID");
  const [correlationValue, setCorrelationValue] = useState("");
  const [rows, setRows] = useState<TAuditLogTraceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [searched, setSearched] = useState(false);

  const correlationOptions = useMemo(() => {
    const keys = Array.from(new Set(catalog.flatMap((entry) => entry.correlationKeys))).sort();
    return keys.map((key) => ({ value: key, label: key }));
  }, [catalog]);

  const toggle = (id: string): void => {
    onChangeSelection(selectedEnvironmentIds.includes(id) ? selectedEnvironmentIds.filter((item) => item !== id) : [...selectedEnvironmentIds, id]);
  };

  const runTrace = async (): Promise<void> => {
    if (!selectedEnvironmentIds.length || !correlationColumn || !correlationValue) return;
    setLoading(true);
    setError(undefined);
    setSearched(true);
    const response = await toolStudioApi.traceAuditLog({ environmentIds: selectedEnvironmentIds, correlationColumn, correlationValue });
    if (response.error) setError(response.error);
    const sorted = [...response.rows].sort((left, right) => rowTimestamp(left).localeCompare(rowTimestamp(right)));
    setRows(sorted);
    setLoading(false);
  };

  if (!environments.length) {
    return <EmptyState>Register at least one environment in the Environments tab first.</EmptyState>;
  }

  return (
    <div>
      <div className="ts-card">
        <p className="note" style={{ marginTop: 0 }}>
          Finds every log table (in every selected environment) that has a matching correlation-key column, and returns every row where that column equals the value below — the "trace this CR/activation end-to-end" view.
        </p>
        <div className="row" style={{ flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          {environments.map((environment) => (
            <label key={environment.id} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={selectedEnvironmentIds.includes(environment.id)} onChange={() => toggle(environment.id)} />
              {environment.projectName} / {environment.envLabel}
            </label>
          ))}
        </div>
        <div className="ts-grid-2">
          <div className="field">
            <label>Correlation key</label>
            <SearchableSelect value={correlationColumn} onChange={setCorrelationColumn} options={correlationOptions} placeholder="e.g. reqID" />
          </div>
          <div className="field">
            <label>Value</label>
            <input className="input" placeholder="e.g. CR-2026-00123" value={correlationValue} onChange={(event) => setCorrelationValue(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void runTrace()} />
          </div>
        </div>
        <div className="row">
          <Button disabled={!selectedEnvironmentIds.length || !correlationValue || loading} onClick={() => void runTrace()}>
            {loading ? <Spinner /> : "Trace"}
          </Button>
        </div>
      </div>

      {error && <div className="errbox" style={{ marginTop: 12 }}>{error}</div>}

      {searched && !loading && !error && (
        rows.length ? (
          <div style={{ marginTop: 12 }}>
            <div className="note" style={{ marginBottom: 8 }}>{rows.length} row(s) found, oldest first.</div>
            {rows.map((row, index) => (
              <TraceRowCard key={`${row.environmentId}-${row.catalogId}-${row.schema}-${row.table}-${index}`} row={row} />
            ))}
          </div>
        ) : (
          <EmptyState>No rows found for {correlationColumn} = {correlationValue} in the selected environments.</EmptyState>
        )
      )}
    </div>
  );
}
