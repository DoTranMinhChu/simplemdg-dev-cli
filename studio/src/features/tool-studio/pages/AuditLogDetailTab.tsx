import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TAuditLogDefinition, TAuditLogDetailFilter, TAuditLogDetailFilterOp, TAuditLogEnvironment, TResolvedAuditLogTable } from "../api/tool-studio-api-client";
import type { TDatabaseQueryResult } from "../../../api/studio-api-types";

const FILTER_OPS: Array<{ value: TAuditLogDetailFilterOp; label: string }> = [
  { value: "eq", label: "=" },
  { value: "contains", label: "contains" },
  { value: "gte", label: ">=" },
  { value: "lte", label: "<=" },
];

const PAGE_SIZE = 100;

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function AuditLogDetailTab({
  environments,
  catalog,
  initialTarget,
}: {
  environments: TAuditLogEnvironment[];
  catalog: TAuditLogDefinition[];
  initialTarget?: { environmentId: string; catalogId: string; tableIndex?: number };
}): React.ReactElement {
  const [environmentId, setEnvironmentId] = useState(initialTarget?.environmentId ?? environments[0]?.id ?? "");
  const [catalogId, setCatalogId] = useState(initialTarget?.catalogId ?? "");
  const [tableIndex, setTableIndex] = useState(initialTarget?.tableIndex ?? 0);
  const [filters, setFilters] = useState<TAuditLogDetailFilter[]>([]);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<TDatabaseQueryResult | undefined>();
  const [total, setTotal] = useState<number | undefined>();
  const [availableTables, setAvailableTables] = useState<TResolvedAuditLogTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Which catalog entries actually have a matching table in the currently-selected environment —
  // undefined while resolving, so the "Log" dropdown doesn't flash the full unfiltered list first.
  const [foundCatalogIds, setFoundCatalogIds] = useState<Set<string> | undefined>();
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | undefined>();

  useEffect(() => {
    if (initialTarget) {
      setEnvironmentId(initialTarget.environmentId);
      setCatalogId(initialTarget.catalogId);
      setTableIndex(initialTarget.tableIndex ?? 0);
      setOffset(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTarget]);

  useEffect(() => {
    if (!environmentId) return;
    setResolving(true);
    setResolveError(undefined);
    setFoundCatalogIds(undefined);
    void toolStudioApi.resolveAuditLogEnvironment(environmentId, false).then((response) => {
      if (response.error || !response.resolution) {
        setResolveError(response.error ?? "Resolve failed");
        setFoundCatalogIds(new Set());
      } else if (response.resolution.error) {
        setResolveError(response.resolution.error);
        setFoundCatalogIds(new Set());
      } else {
        const found = new Set(response.resolution.entries.filter((entry) => entry.tables.length > 0).map((entry) => entry.catalogId));
        setFoundCatalogIds(found);
        // A log that was picked before switching environments (or via "open in Detail" from Stats)
        // might not exist here — clear it rather than silently querying a stale selection.
        setCatalogId((current) => (current && !found.has(current) ? "" : current));
      }
      setResolving(false);
    });
  }, [environmentId]);

  const load = async (nextOffset = offset): Promise<void> => {
    if (!environmentId || !catalogId) return;
    setLoading(true);
    setError(undefined);
    const response = await toolStudioApi.getAuditLogDetail({
      environmentId,
      catalogId,
      tableIndex,
      limit: PAGE_SIZE,
      offset: nextOffset,
      filters,
    });
    if (response.error) {
      setError(response.error);
      setResult(undefined);
    } else {
      setResult(response.result);
      if (response.total !== undefined) setTotal(response.total);
    }
    setAvailableTables(response.availableTables ?? []);
    setOffset(nextOffset);
    setLoading(false);
  };

  useEffect(() => {
    if (environmentId && catalogId) void load(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environmentId, catalogId, tableIndex]);

  if (!environments.length) {
    return <EmptyState>Register at least one environment in the Environments tab first.</EmptyState>;
  }

  const definition = catalog.find((entry) => entry.id === catalogId);
  const availableCatalog = foundCatalogIds ? catalog.filter((entry) => foundCatalogIds.has(entry.id)) : [];

  return (
    <div>
      <div className="ts-card">
        <div className="ts-grid-2">
          <div className="field">
            <label>Environment</label>
            <SearchableSelect
              value={environmentId}
              onChange={(value) => {
                setEnvironmentId(value);
                setOffset(0);
              }}
              options={environments.map((environment) => ({ value: environment.id, label: `${environment.projectName} / ${environment.envLabel}` }))}
            />
          </div>
          <div className="field">
            <label>Log {resolving ? "(checking what exists here...)" : `(${availableCatalog.length} found in this environment)`}</label>
            <SearchableSelect
              value={catalogId}
              onChange={(value) => {
                setCatalogId(value);
                setTableIndex(0);
                setOffset(0);
              }}
              disabled={resolving}
              options={availableCatalog.map((entry) => ({ value: entry.id, label: entry.displayName, meta: entry.category }))}
              placeholder={resolving ? "Checking..." : "Select a log type..."}
              emptyMessage="No log in the catalog has a matching table in this environment."
            />
          </div>
        </div>

        {resolveError && <div className="errbox" style={{ marginTop: 0, marginBottom: 8 }}>{resolveError}</div>}
        {definition && <p className="note" style={{ marginTop: 0 }}>{definition.description}</p>}

        {availableTables.length > 1 && (
          <div className="field">
            <label>Resolved table ({availableTables.length} matches for this log type)</label>
            <SearchableSelect
              value={String(tableIndex)}
              onChange={(value) => setTableIndex(Number(value))}
              options={availableTables.map((table, index) => ({ value: String(index), label: `${table.schema}.${table.name}` }))}
            />
          </div>
        )}

        <div className="field">
          <label>Filters</label>
          {filters.map((filter, index) => (
            <div key={index} className="row" style={{ gap: 6, marginBottom: 4 }}>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="column name"
                value={filter.column}
                onChange={(event) => setFilters((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, column: event.target.value } : item)))}
              />
              <select
                className="input"
                style={{ width: 110 }}
                value={filter.op}
                onChange={(event) => setFilters((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, op: event.target.value as TAuditLogDetailFilterOp } : item)))}
              >
                {FILTER_OPS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <input
                className="input"
                style={{ flex: 1 }}
                placeholder="value"
                value={filter.value}
                onChange={(event) => setFilters((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, value: event.target.value } : item)))}
              />
              <Button variant="ghost" size="sm" onClick={() => setFilters((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}>✕</Button>
            </div>
          ))}
          <Button variant="sec" size="sm" onClick={() => setFilters((prev) => [...prev, { column: "", op: "eq", value: "" }])}>+ Add filter</Button>
        </div>

        <div className="row">
          <Button disabled={!environmentId || !catalogId || loading} onClick={() => void load(0)}>
            {loading ? <Spinner /> : "Load"}
          </Button>
        </div>
      </div>

      {error && <div className="errbox" style={{ marginTop: 12 }}>{error}</div>}

      {!error && !result && !loading && catalogId && <EmptyState>No matching table for this log in this environment.</EmptyState>}

      {result && (
        <div className="ts-card" style={{ marginTop: 12 }}>
          <div className="row" style={{ marginBottom: 8, alignItems: "baseline" }}>
            <span className="note" style={{ flex: 1 }}>
              {total !== undefined ? `${total.toLocaleString()} total row(s)` : `${result.rowCount} row(s) on this page`} · {result.durationMs}ms
            </span>
            <Button variant="sec" size="sm" disabled={offset === 0 || loading} onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}>← Prev</Button>
            <Button variant="sec" size="sm" disabled={loading || result.rows.length < PAGE_SIZE} onClick={() => void load(offset + PAGE_SIZE)}>Next →</Button>
          </div>
          <div style={{ overflow: "auto", maxHeight: 500 }}>
            <table className="grid">
              <thead>
                <tr>
                  {result.fields.map((field) => (
                    <th key={field} style={{ textAlign: "left" }}>{field}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {result.fields.map((field) => (
                      <td key={field} style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={formatCellValue(row[field])}>
                        {formatCellValue(row[field])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {!result.rows.length && <EmptyState>No rows match these filters.</EmptyState>}
          </div>
        </div>
      )}
    </div>
  );
}
