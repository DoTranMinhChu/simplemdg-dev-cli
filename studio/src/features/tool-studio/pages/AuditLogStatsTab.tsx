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

const BREAKDOWN_COLLAPSED_LIMIT = 4;

type TWindowMode = "hours" | "days" | "range";

/** `onSelect(undefined)` = today's unfiltered "open in Detail"; `onSelect(value)` = open pre-filtered to that status value. */
function StatCellView({
  cell,
  windowLabel,
  onSelect,
}: {
  cell: TAuditLogStatCell | undefined;
  windowLabel: string;
  onSelect: (statusValue?: string) => void;
}): React.ReactElement {
  const [tablesExpanded, setTablesExpanded] = useState(false);
  const [breakdownExpanded, setBreakdownExpanded] = useState(false);

  if (!cell) return <span className="note">—</span>;
  if (!cell.tables.length) return <span className="note">not found</span>;

  const breakdown = cell.statusBreakdown ?? [];
  const maxCount = breakdown[0]?.count ?? 0;
  const visibleBreakdown = breakdownExpanded ? breakdown : breakdown.slice(0, BREAKDOWN_COLLAPSED_LIMIT);
  const hiddenCount = breakdown.length - visibleBreakdown.length;

  return (
    <div className="audit-stat-cell">
      <div className="audit-stat-total" onClick={() => onSelect(undefined)}>
        <b>{cell.totalRows.toLocaleString()}</b> row(s)
        {!!cell.recentRows && (
          <span
            className="audit-stat-recent-badge"
            title={`${cell.recentRows.toLocaleString()} row(s) ${windowLabel}${cell.lastActivityAt ? ` — last activity ${new Date(cell.lastActivityAt).toLocaleString()}` : ""}`}
          >
            +{cell.recentRows.toLocaleString()} new
          </span>
        )}
        {cell.tables.length > 1 && (
          <button
            type="button"
            className="audit-stat-tables-toggle"
            onClick={(event) => {
              event.stopPropagation();
              setTablesExpanded((prev) => !prev);
            }}
          >
            {cell.tables.length} tables {tablesExpanded ? "▾" : "▸"}
          </button>
        )}
      </div>
      {tablesExpanded && cell.tables.length > 1 && (
        <ul className="audit-stat-table-list">
          {cell.tables.map((table) => (
            <li key={`${table.schema}.${table.table}`}>
              <span title={`${table.schema}.${table.table}`}>{table.schema}.{table.table}</span>
              <span>{table.error ? "error" : (table.totalRows ?? 0).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
      {visibleBreakdown.length > 0 && (
        <div className="audit-stat-breakdown">
          {visibleBreakdown.map((entry) => (
            <div
              key={entry.value}
              className="audit-stat-bar-row"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(entry.value);
              }}
            >
              <span className="audit-stat-bar-label" title={entry.value || "(null)"}>{entry.value || "(null)"}</span>
              <span className="audit-stat-bar-track">
                <span className="audit-stat-bar-fill" style={{ width: `${maxCount ? (entry.count / maxCount) * 100 : 0}%` }} />
              </span>
              <span className="audit-stat-bar-count">{entry.count.toLocaleString()}</span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <button
              type="button"
              className="audit-stat-more"
              onClick={(event) => {
                event.stopPropagation();
                setBreakdownExpanded(true);
              }}
            >
              +{hiddenCount} more
            </button>
          )}
        </div>
      )}
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
  onOpenDetail: (environmentId: string, catalogId: string, statusFilter?: { column: string; value: string }) => void;
}): React.ReactElement {
  const [windowMode, setWindowMode] = useState<TWindowMode>("hours");
  const [windowHours, setWindowHours] = useState(24);
  const [windowDays, setWindowDays] = useState(7);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [jobId, setJobId] = useState<string | undefined>();
  const [steps, setSteps] = useState<TJobStep[]>([]);
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<TAuditLogStatsResult[]>([]);
  const [scannedWindowLabel, setScannedWindowLabel] = useState("recent");
  const [error, setError] = useState<string | undefined>();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useJobEvents(jobId, (event) => {
    if (event.steps) setSteps((prev) => mergeJobSteps(prev, event.steps!));
  });

  const toggle = (id: string): void => {
    onChangeSelection(selectedEnvironmentIds.includes(id) ? selectedEnvironmentIds.filter((item) => item !== id) : [...selectedEnvironmentIds, id]);
  };

  // Captured at scan time (not recomputed live) so a result table always shows the label for the
  // window that was ACTUALLY used — changing the controls afterward shouldn't relabel old results.
  const currentWindow = (): { since?: string; until?: string; label: string } => {
    if (windowMode === "hours") return { since: new Date(Date.now() - windowHours * 3_600_000).toISOString(), label: `in last ${windowHours}h` };
    if (windowMode === "days") return { since: new Date(Date.now() - windowDays * 86_400_000).toISOString(), label: `in last ${windowDays}d` };
    const since = rangeFrom ? new Date(rangeFrom).toISOString() : undefined;
    const until = rangeTo ? new Date(rangeTo).toISOString() : undefined;
    const label =
      rangeFrom && rangeTo
        ? `between ${new Date(rangeFrom).toLocaleString()} and ${new Date(rangeTo).toLocaleString()}`
        : rangeFrom
          ? `since ${new Date(rangeFrom).toLocaleString()}`
          : rangeTo
            ? `until ${new Date(rangeTo).toLocaleString()}`
            : "in range";
    return { since, until, label };
  };

  const runScan = async (): Promise<void> => {
    if (!selectedEnvironmentIds.length) return;
    const id = newJobId();
    const window = currentWindow();
    setJobId(id);
    setSteps(selectedEnvironmentIds.map((envId) => ({ key: envId, label: environments.find((e) => e.id === envId)?.envLabel ?? envId, status: "pending" })));
    setScanning(true);
    setError(undefined);
    setScannedWindowLabel(window.label);
    const response = await toolStudioApi.getAuditLogStats({ environmentIds: selectedEnvironmentIds, since: window.since, until: window.until, jobId: id });
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
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="note">"Recent" window</label>
          <select className="input" style={{ width: 150 }} value={windowMode} onChange={(event) => setWindowMode(event.target.value as TWindowMode)}>
            <option value="hours">Last N hours</option>
            <option value="days">Last N days</option>
            <option value="range">Custom range</option>
          </select>
          {windowMode === "hours" && (
            <input className="input" type="number" min={1} style={{ width: 80 }} value={windowHours} onChange={(event) => setWindowHours(Math.max(1, Number(event.target.value) || 1))} />
          )}
          {windowMode === "days" && (
            <input className="input" type="number" min={1} style={{ width: 80 }} value={windowDays} onChange={(event) => setWindowDays(Math.max(1, Number(event.target.value) || 1))} />
          )}
          {windowMode === "range" && (
            <>
              <input className="input" type="datetime-local" style={{ width: 200 }} value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} />
              <span className="note">to</span>
              <input className="input" type="datetime-local" style={{ width: 200 }} value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} />
            </>
          )}
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
          Total row counts are always exact and unaffected by this window — it only controls the extra "+N in last..." count shown under each log
          type, i.e. how much NEW activity happened in that window. Runs a resolve (if not cached) plus one or two count queries per log type, per
          environment — can take a while for many environments/log types.
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
            {hiddenCount > 0 ? ` (${hiddenCount} not present anywhere selected, hidden)` : ""}. "+N new" below is counted {scannedWindowLabel} — hover
            a badge for the exact range.
          </div>
          <table className="audit-stats-table">
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
                      <td key={environment.id}>
                        <StatCellView
                          cell={cell}
                          windowLabel={scannedWindowLabel}
                          onSelect={(statusValue) =>
                            onOpenDetail(
                              environment.id,
                              definition.id,
                              statusValue !== undefined && definition.statusColumn ? { column: definition.statusColumn, value: statusValue } : undefined,
                            )
                          }
                        />
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
