import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TAuditLogDefinition, TAuditLogEnvironment, TAuditLogStatCell, TAuditLogStatsResult } from "../api/tool-studio-api-client";
import { useJobEvents, mergeJobSteps } from "../hooks/useJobEvents";
import type { TJobStep } from "../hooks/useJobEvents";

function newJobId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCell(cell: TAuditLogStatCell | undefined): React.ReactElement {
  if (!cell) return <span className="note">—</span>;
  if (!cell.tables.length) return <span className="note">not found</span>;
  return (
    <div>
      <div>
        {cell.totalRows.toLocaleString()} row(s){cell.tables.length > 1 ? ` across ${cell.tables.length} tables` : ""}
      </div>
      {cell.recentRows !== undefined && <div className="note">+{cell.recentRows.toLocaleString()} recent</div>}
      {cell.lastActivityAt && <div className="note">last: {new Date(cell.lastActivityAt).toLocaleString()}</div>}
      {cell.errorCount > 0 && <div className="errbox" style={{ padding: "2px 6px", marginTop: 2 }}>{cell.errorCount} table(s) errored</div>}
    </div>
  );
}

export function AuditLogStatsTab({
  environments,
  catalog,
  selectedEnvironmentIds,
  onChangeSelection,
  onOpenDetail,
}: {
  environments: TAuditLogEnvironment[];
  catalog: TAuditLogDefinition[];
  selectedEnvironmentIds: string[];
  onChangeSelection: (ids: string[]) => void;
  onOpenDetail: (environmentId: string, catalogId: string) => void;
}): React.ReactElement {
  const [sinceHours, setSinceHours] = useState(24);
  const [jobId, setJobId] = useState<string | undefined>();
  const [steps, setSteps] = useState<TJobStep[]>([]);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<TAuditLogStatsResult[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useJobEvents(jobId, (event) => {
    if (event.steps) setSteps((prev) => mergeJobSteps(prev, event.steps!));
  });

  const toggle = (id: string): void => {
    onChangeSelection(selectedEnvironmentIds.includes(id) ? selectedEnvironmentIds.filter((item) => item !== id) : [...selectedEnvironmentIds, id]);
  };

  const runScan = async (): Promise<void> => {
    if (!selectedEnvironmentIds.length) return;
    const id = newJobId();
    setJobId(id);
    setSteps(selectedEnvironmentIds.map((envId) => ({ key: envId, label: environments.find((e) => e.id === envId)?.envLabel ?? envId, status: "pending" })));
    setScanning(true);
    setError(undefined);
    const response = await toolStudioApi.getAuditLogStats({ environmentIds: selectedEnvironmentIds, sinceHours, jobId: id });
    if (response.error) setError(response.error);
    setResults(response.results);
    setScanning(false);
  };

  const selectedEnvironments = environments.filter((environment) => selectedEnvironmentIds.includes(environment.id));
  const cellsByEnv = new Map(results.map((result) => [result.environmentId, result]));
  const categories = Array.from(new Set(catalog.map((entry) => entry.category)));
  const categoryFiltered = categoryFilter === "all" ? catalog : catalog.filter((entry) => entry.category === categoryFilter);
  // Once a scan has run, a log type that resolved to zero tables in every selected environment
  // is just noise — drop the row instead of showing a "not found" placeholder in every column.
  const hasAnyTable = (definitionId: string): boolean =>
    selectedEnvironments.some((environment) => (cellsByEnv.get(environment.id)?.cells?.[definitionId]?.tables.length ?? 0) > 0);
  const visibleCatalog = results.length ? categoryFiltered.filter((entry) => hasAnyTable(entry.id)) : categoryFiltered;
  const hiddenCount = results.length ? categoryFiltered.length - visibleCatalog.length : 0;

  if (!environments.length) {
    return <EmptyState>Register at least one environment in the Environments tab first.</EmptyState>;
  }

  return (
    <div>
      <div className="ts-card">
        <div className="note" style={{ marginBottom: 6 }}>Environments to scan:</div>
        <div className="row" style={{ flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          {environments.map((environment) => (
            <label key={environment.id} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={selectedEnvironmentIds.includes(environment.id)} onChange={() => toggle(environment.id)} />
              {environment.projectName} / {environment.envLabel}
            </label>
          ))}
        </div>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <label className="note">Window (hours)</label>
          <input className="input" type="number" style={{ width: 90 }} value={sinceHours} onChange={(event) => setSinceHours(Number(event.target.value) || 24)} />
          <label className="note">Category</label>
          <select className="input" style={{ width: 200 }} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <div style={{ flex: 1 }} />
          <Button disabled={!selectedEnvironmentIds.length || scanning} onClick={() => void runScan()}>
            {scanning ? <Spinner /> : "Run stats scan"}
          </Button>
        </div>
        <p className="note" style={{ marginTop: 8 }}>
          Runs a resolve (if not cached) plus one or two count queries per log type, per environment — can take a while for many environments/log types.
        </p>
      </div>

      {scanning && (
        <div className="ts-card" style={{ marginTop: 12 }}>
          {steps.map((step) => (
            <div key={step.key} className="row" style={{ gap: 8, padding: "2px 0" }}>
              <span className={`cbadge ${step.status === "success" ? "fresh" : step.status === "failed" ? "expired" : step.status === "running" ? "refreshing" : "missing"}`}>{step.status}</span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="errbox" style={{ marginTop: 12 }}>{error}</div>}

      {results.length > 0 && (
        <div className="ts-card" style={{ marginTop: 12, overflow: "auto" }}>
          <div className="note" style={{ marginBottom: 8 }}>
            Showing {visibleCatalog.length} log type(s) found in at least one selected environment
            {hiddenCount > 0 ? ` (${hiddenCount} not present anywhere selected, hidden)` : ""}.
          </div>
          <table className="grid">
            <thead>
              <tr>
                <th style={{ textAlign: "left", minWidth: 220 }}>Log</th>
                {selectedEnvironments.map((environment) => (
                  <th key={environment.id} style={{ textAlign: "left", minWidth: 180 }}>
                    {environment.projectName}
                    <div className="note">{environment.envLabel}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCatalog.map((definition) => (
                <tr key={definition.id}>
                  <td>
                    <div>{definition.displayName}</div>
                    <div className="note">{definition.tier === "master-data-domain" ? "master-data domain" : definition.module ?? "core"}</div>
                  </td>
                  {selectedEnvironments.map((environment) => {
                    const cell = cellsByEnv.get(environment.id)?.cells?.[definition.id];
                    return (
                      <td
                        key={environment.id}
                        style={{ cursor: cell?.tables.length ? "pointer" : "default" }}
                        onClick={() => {
                          if (cell?.tables.length) onOpenDetail(environment.id, definition.id);
                        }}
                      >
                        {formatCell(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
