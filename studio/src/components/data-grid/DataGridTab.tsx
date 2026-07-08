import { useCallback, useEffect, useRef, useState } from "react";
import { DataGridToolbar } from "./DataGridToolbar";
import { DataGridFooter } from "./DataGridFooter";
import { PendingChangesBar } from "./PendingChangesBar";
import { EditableCell } from "./EditableCell";
import { CellValueInspector, type TCellInspectorInput } from "./CellValueInspector";
import { EmptyState } from "../common/EmptyState";
import { ErrorPanel } from "../common/ErrorPanel";
import { studioApi } from "../../api/studio-api-client";
import { useStudioStore } from "../../state/studio-store";
import { useWorkspaceStore, type TWorkspaceTab } from "../../state/workspace-store";
import type { TDatabaseColumn, TDatabaseErrorInfo, TRecoveryAction } from "../../api/studio-api-types";

function rowKeyOf(pk: string[], row: Record<string, unknown>): string {
  return pk.map((key) => String(row[key])).join("");
}

type TInsertRow = { seq: number; values: Record<string, string>; error?: string };

export function DataGridTab({ tab }: { tab: TWorkspaceTab }): React.ReactElement {
  const { toast, setStatusBar, activeConnectionId, connections } = useStudioStore();
  const { openTab, layout, setTabDirty } = useWorkspaceStore();

  const connectionId = tab.connectionId || activeConnectionId;
  const schema = tab.schema ?? "";
  const table = tab.objectName ?? "";

  const [columns, setColumns] = useState<TDatabaseColumn[]>([]);
  const [pk, setPk] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [offset, setOffset] = useState(tab.pageIndex ?? 0);
  const [pageSize, setPageSize] = useState(String(tab.pageSize ?? 100));
  const [where, setWhere] = useState(tab.filter ?? "");
  const [sortColumn, setSortColumn] = useState(tab.sort?.[0]?.column ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(tab.sort?.[0]?.direction ?? "asc");
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; info?: TDatabaseErrorInfo; recoveryActions?: TRecoveryAction[] } | undefined>();
  const isFirstLoadRef = useRef(true);
  const [rangeText, setRangeText] = useState("");
  const [durationText, setDurationText] = useState("");

  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [editErrors, setEditErrors] = useState<Record<string, string>>({});
  const [deletes, setDeletes] = useState<Record<string, true>>({});
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [inserts, setInserts] = useState<TInsertRow[]>([]);
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [insertSeq, setInsertSeq] = useState(0);
  const [inspector, setInspector] = useState<TCellInspectorInput | null>(null);

  const editable = pk.length > 0 && !layout.readOnly;
  const pendingCount = Object.keys(edits).length + Object.keys(deletes).length + inserts.length;

  useEffect(() => {
    setTabDirty(tab.id, pendingCount > 0);
    setStatusBar({ pendingCount });
  }, [pendingCount, tab.id, setTabDirty, setStatusBar]);

  const loadMeta = useCallback(async () => {
    const [columnsResponse, pkResponse] = await Promise.all([studioApi.getColumns(connectionId, schema, table), studioApi.getPrimaryKey(connectionId, schema, table)]);
    setColumns(columnsResponse.columns ?? []);
    setPk(pkResponse.primaryKey.columns);
  }, [connectionId, schema, table]);

  const loadData = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await studioApi.getTableData({
        connectionId,
        schema,
        table,
        limit: parseInt(pageSize, 10),
        offset,
        where: where || undefined,
        orderBy: sortColumn || undefined,
        orderDirection: sortDir,
      });

      if (!response.result) {
        setError({ message: response.error ?? "Cannot load data.", info: response.errorInfo, recoveryActions: response.recoveryActions });
        return false;
      }

      setRows(response.result.rows);
      setSelected({});
      const to = offset + response.result.rowCount;
      setRangeText(`Showing ${response.result.rowCount ? offset + 1 : 0}-${to}${total != null ? ` of ${total.toLocaleString()}` : ""}`);
      setDurationText(`Duration: ${response.result.durationMs}ms · Offset: ${offset}`);
      setStatusBar({ duration: `${response.result.durationMs}ms`, rows: total != null ? `${total} total` : `${response.result.rowCount} rows` });
      return true;
    } catch (fetchError) {
      setError({ message: fetchError instanceof Error ? fetchError.message : String(fetchError) });
      return false;
    } finally {
      setLoading(false);
    }
  }, [connectionId, schema, table, pageSize, offset, where, sortColumn, sortDir, total, setStatusBar]);

  const loadCount = useCallback(async () => {
    try {
      const response = await studioApi.getTableCount(connectionId, schema, table);
      setTotal(response.count);
      setStatusBar({ rows: `${response.count} total` });
    } catch {
      // non-fatal
    }
  }, [connectionId, schema, table, setStatusBar]);

  // Load order matters: table data is the primary, user-visible request. Only
  // fetch metadata (columns/PK) and the row count — both independent, lower-
  // priority calls — once we know the connection is actually reachable, so a
  // dead connection produces exactly one failed request instead of three.
  useEffect(() => {
    loadData().then((success) => {
      if (success && isFirstLoadRef.current) {
        isFirstLoadRef.current = false;
        loadMeta().catch(() => undefined);
        loadCount();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, pageSize, sortColumn, sortDir]);

  const applyFilter = (): void => {
    setOffset(0);
    loadData();
  };

  const toggleSort = (column: string): void => {
    if (sortColumn === column) setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    else {
      setSortColumn(column);
      setSortDir("asc");
    }
    setOffset(0);
  };

  const fields = columns.length ? columns.map((column) => column.name) : rows[0] ? Object.keys(rows[0]) : [];

  const commitEdit = (row: Record<string, unknown>, field: string, newValue: string): void => {
    const key = rowKeyOf(pk, row);
    const original = row[field] == null ? "" : String(row[field]);
    setEdits((prev) => {
      const next = { ...prev };
      if (newValue !== original) {
        next[key] = { ...next[key], [field]: newValue };
      } else if (next[key]) {
        const rowEdits = { ...next[key] };
        delete rowEdits[field];
        if (Object.keys(rowEdits).length) next[key] = rowEdits;
        else delete next[key];
      }
      return next;
    });
  };

  const toggleSelected = (key: string): void => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const toggleDeleteSelected = (): void => {
    const keys = Object.keys(selected);
    if (!keys.length) return toast("Select one or more rows (click the row number).", "warn");
    if (keys.every((key) => deletes[key])) {
      setDeletes((prev) => {
        const next = { ...prev };
        keys.forEach((key) => delete next[key]);
        return next;
      });
      return;
    }
    if (keys.length > 1 && !window.confirm(`Mark ${keys.length} selected rows for deletion? They will not be deleted until you Save Changes.`)) return;
    setDeletes((prev) => ({ ...prev, ...Object.fromEntries(keys.map((key) => [key, true as const])) }));
    setSelected({});
  };

  const addInsertRow = (): void => {
    setInsertSeq((prev) => prev + 1);
    setInserts((prev) => [...prev, { seq: insertSeq + 1, values: {} }]);
  };

  const revertAll = (): void => {
    setEdits({});
    setEditErrors({});
    setDeletes({});
    setDeleteErrors({});
    setInserts([]);
    toast("Reverted pending changes.");
  };

  const saveChanges = async (): Promise<void> => {
    if (layout.readOnly) return toast("Read-only mode is on.", "warn");

    const updateKeys = Object.keys(edits);
    const deleteKeys = Object.keys(deletes);
    const insertsToSave = inserts.filter((insert) => Object.keys(insert.values).length);
    const insertsSkipped = inserts.filter((insert) => !Object.keys(insert.values).length);

    const updatePayload = updateKeys.map((key) => {
      const row = rows.find((item) => rowKeyOf(pk, item) === key);
      const keyObj: Record<string, unknown> = {};
      pk.forEach((column) => (keyObj[column] = row?.[column]));
      return { key: keyObj, changes: edits[key] };
    });
    const deletePayload = deleteKeys.map((key) => {
      const row = rows.find((item) => rowKeyOf(pk, item) === key);
      const keyObj: Record<string, unknown> = {};
      pk.forEach((column) => (keyObj[column] = row?.[column]));
      return { key: keyObj };
    });
    const insertPayload = insertsToSave.map((insert) => ({ values: insert.values }));

    const totalChanges = updatePayload.length + deletePayload.length + insertPayload.length;
    if (!totalChanges) return toast("No changes to save.", "warn");
    if (!window.confirm(`Save changes?\n\nUpdates: ${updatePayload.length}\nInserts: ${insertPayload.length}\nDeletes: ${deletePayload.length}`)) return;

    try {
      const response = await studioApi.saveTableChanges({ connectionId, schema, table, primaryKeyColumns: pk, updates: updatePayload, inserts: insertPayload, deletes: deletePayload });
      if (response.blocked) {
        toast(response.error ?? "Blocked by read-only mode.", "err");
        return;
      }
      const result = response.result;
      const rowResults = result?.rowResults ?? [];
      let cursor = 0;

      // Server returns rowResults in request order: updates, then inserts, then deletes.
      const nextEdits = { ...edits };
      const nextEditErrors: Record<string, string> = {};
      updateKeys.forEach((key) => {
        const rowResult = rowResults[cursor++];
        if (rowResult?.success) delete nextEdits[key];
        else nextEditErrors[key] = rowResult?.error ?? "Failed";
      });

      const nextInserts: TInsertRow[] = [...insertsSkipped];
      insertsToSave.forEach((insert) => {
        const rowResult = rowResults[cursor++];
        if (!rowResult?.success) nextInserts.push({ ...insert, error: rowResult?.error ?? "Failed" });
      });

      const nextDeletes = { ...deletes };
      const nextDeleteErrors: Record<string, string> = {};
      deleteKeys.forEach((key) => {
        const rowResult = rowResults[cursor++];
        if (rowResult?.success) delete nextDeletes[key];
        else nextDeleteErrors[key] = rowResult?.error ?? "Failed";
      });

      const ok = (result?.updated ?? 0) + (result?.inserted ?? 0) + (result?.deleted ?? 0);
      const failed = rowResults.filter((item) => !item.success).length;
      toast(failed ? `${ok} saved, ${failed} failed. Failed rows kept pending with error markers.` : `${ok} change(s) saved.`, failed ? "err" : "ok");

      setEdits(nextEdits);
      setEditErrors(nextEditErrors);
      setInserts(nextInserts);
      setDeletes(nextDeletes);
      setDeleteErrors(nextDeleteErrors);
      await loadData();
      await loadCount();
    } catch (saveError) {
      toast(saveError instanceof Error ? saveError.message : String(saveError), "err");
    }
  };

  const connection = connections.find((item) => item.id === connectionId);
  const canRefreshFromBtp = Boolean(connection?.app && connection?.region && connection?.org && connection?.space);

  const reconnect = async (): Promise<void> => {
    toast("Reconnecting...");
    const result = await studioApi.reconnectConnection(connectionId);
    if (result.success) {
      toast("Reconnected.");
      loadData();
    } else {
      toast(`Reconnect failed: ${result.message ?? ""}`, "err");
    }
  };

  const refreshFromBtp = async (): Promise<void> => {
    toast("Refreshing credentials from BTP...");
    const result = await studioApi.refreshCredentialsFromBtp(connectionId);
    if (result.ok) {
      toast(result.test?.success ? "Credentials refreshed and tested OK." : `Credentials refreshed (test: ${result.test?.message ?? "n/a"})`, result.test?.success ? "ok" : "warn");
      loadData();
    } else {
      toast(`Refresh from BTP failed: ${result.error ?? ""}`, "err");
    }
  };

  const exportCurrentPage = (format: "csv" | "json"): void => {
    if (!rows.length) return toast("No rows to export.", "warn");
    fetch(studioApi.exportUrl(format), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields, rows }),
    })
      .then((response) => response.blob())
      .then((blob) => {
        const anchor = document.createElement("a");
        anchor.href = URL.createObjectURL(blob);
        anchor.download = `${table}.${format}`;
        anchor.click();
        toast(`Exported current page as ${format.toUpperCase()}`);
      });
  };

  if (error) {
    return (
      <div className="tabpane">
        <div className="crumbs">
          <span>{schema}</span>
          <span className="sep">›</span>
          <span>{table}</span>
        </div>
        <div className="pane-body">
          <ErrorPanel
            title={`Cannot load data from ${table}`}
            error={{ message: error.message, kind: error.info?.kind, technicalMessage: error.info?.originalMessage, recoveryActions: error.recoveryActions }}
            onRetry={() => loadData()}
            onReconnect={reconnect}
            onRefreshFromBtp={refreshFromBtp}
            canRefreshFromBtp={canRefreshFromBtp}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="tabpane">
      <div className="crumbs">
        <span>{schema}</span>
        <span className="sep">›</span>
        <span>{table}</span>
      </div>
      <DataGridToolbar
        where={where}
        onWhereChange={setWhere}
        onApplyFilter={applyFilter}
        onRefresh={loadData}
        refreshing={loading}
        onInsertRow={addInsertRow}
        onDeleteSelected={toggleDeleteSelected}
        canEdit={editable}
        onOpenStructure={() =>
          openTab({ key: `struct:${connectionId}:${schema}.${table}`, kind: "metadata", title: `Structure: ${table}`, connectionId, schema, objectName: table, objectType: tab.objectType })
        }
        onExport={() => exportCurrentPage("csv")}
      />
      <PendingChangesBar updates={Object.keys(edits).length} inserts={inserts.length} deletes={Object.keys(deletes).length} onSave={saveChanges} onRevert={revertAll} />
      <div className="gridwrap">
        {loading ? (
          <EmptyState>
            <span className="spin" /> loading data...
          </EmptyState>
        ) : !rows.length && !inserts.length ? (
          <EmptyState>No rows.</EmptyState>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th className="rowhdr">#</th>
                {fields.map((field) => (
                  <th key={field} onClick={() => toggleSort(field)} title="Click to sort">
                    {field}
                    {sortColumn === field ? <span className="sort">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => {
                const key = rowKeyOf(pk, row);
                const isDeleted = Boolean(deletes[key]);
                const rowEdits = edits[key];
                const rowDeleteError = deleteErrors[key];
                return (
                  <tr key={key || rowIndex} className={`${selected[key] ? "selrow " : ""}${isDeleted ? "row-del " : ""}${rowDeleteError ? "row-err " : ""}`}>
                    <td className="rowhdr" onClick={() => toggleSelected(key)} title={rowDeleteError || undefined}>
                      {offset + rowIndex + 1}
                    </td>
                    {fields.map((field) => {
                      const hasEdit = rowEdits && Object.prototype.hasOwnProperty.call(rowEdits, field);
                      const value = hasEdit ? rowEdits[field] : row[field];
                      const column = columns.find((item) => item.name === field);
                      return (
                        <EditableCell
                          key={field}
                          value={value}
                          editable={editable && !isDeleted}
                          edited={Boolean(hasEdit)}
                          error={hasEdit ? editErrors[key] : undefined}
                          onCommit={(newValue) => commitEdit(row, field, newValue)}
                          onOpenInspector={() =>
                            setInspector({
                              connectionId,
                              schema,
                              objectName: table,
                              objectType: tab.objectType,
                              columnName: field,
                              sqlDataType: column?.dataType,
                              value,
                              primaryKey: Object.fromEntries(pk.map((pkCol) => [pkCol, row[pkCol]])),
                              editable: editable && !isDeleted,
                              disabledReason: !editable ? (layout.readOnly ? "Read-only mode is on." : "This table has no primary key, so cells cannot be edited.") : undefined,
                              onApplyEdit: (newValue) => commitEdit(row, field, newValue),
                            })
                          }
                        />
                      );
                    })}
                  </tr>
                );
              })}
              {inserts.map((insert) => (
                <tr key={insert.seq} className={`row-ins${insert.error ? " row-err" : ""}`}>
                  <td className="rowhdr" onClick={() => setInserts((prev) => prev.filter((item) => item.seq !== insert.seq))} title={insert.error || "Click to remove"}>
                    new
                  </td>
                  {fields.map((field) => (
                    <td key={field}>
                      <input
                        className="cellinput"
                        value={insert.values[field] ?? ""}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setInserts((prev) =>
                            prev.map((item) => (item.seq === insert.seq ? { ...item, values: { ...item.values, [field]: nextValue } } : item)),
                          );
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <DataGridFooter
        rangeText={rangeText}
        durationText={durationText}
        pageSize={pageSize}
        onPageSizeChange={(value) => {
          setPageSize(value);
          setOffset(0);
        }}
        onPrevPage={() => setOffset((prev) => Math.max(0, prev - parseInt(pageSize, 10)))}
        onNextPage={() => setOffset((prev) => prev + parseInt(pageSize, 10))}
      />
      {inspector ? <CellValueInspector input={inspector} onClose={() => setInspector(null)} /> : null}
    </div>
  );
}
