import { useEffect, useMemo, useRef, useState } from "react";
import { studioApi } from "../api/studio-api-client";
import { extractReferencedTables } from "./sql-table-refs";
import { SQL_KEYWORDS } from "./sql-keywords";
import type { TSqlSuggestionItem } from "../components/common/SqlAutocompleteTextarea";
import type { TDatabaseColumn } from "../api/studio-api-types";

const COLUMN_LOOKUP_DEBOUNCE_MS = 300;

/**
 * Builds the flat suggestion pool for a free-typed SQL editor: keywords always, table/view names
 * for the connection's active schema, and columns for whatever tables the query's FROM/JOIN
 * clauses currently reference. Column lookups are debounced (typing shouldn't fire a request per
 * keystroke) and cached for the component's lifetime (per connection+schema+table), so retyping
 * or re-referencing the same table is free. Not real IntelliSense — no scope/alias resolution, no
 * dot-triggered narrowing to one table — just "everything plausibly relevant", ranked ahead of
 * generic keywords by SqlAutocompleteTextarea's own sort.
 */
export function useSqlSuggestions(connectionId: string, schema: string, sql: string): TSqlSuggestionItem[] {
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [columnsByTable, setColumnsByTable] = useState<Record<string, TDatabaseColumn[]>>({});
  const columnCacheRef = useRef(new Map<string, TDatabaseColumn[]>());

  // Table/view names for the connection's active schema — refetched only when either changes,
  // not on every keystroke.
  useEffect(() => {
    if (!connectionId || !schema) {
      setTableNames([]);
      return;
    }
    let cancelled = false;
    studioApi
      .getObjects(connectionId, schema, ["table", "view"])
      .then((response) => {
        if (!cancelled) setTableNames((response.objects ?? []).map((object) => object.name));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema]);

  // Columns for whatever tables the query currently references.
  useEffect(() => {
    if (!connectionId) return;
    const handle = setTimeout(() => {
      const refs = extractReferencedTables(sql);
      const missing = refs.filter((ref) => !columnCacheRef.current.has(`${ref.schema ?? schema}.${ref.table}`.toUpperCase()));
      if (!missing.length) return;

      Promise.all(
        missing.map((ref) => {
          const key = `${ref.schema ?? schema}.${ref.table}`.toUpperCase();
          return studioApi
            .getColumns(connectionId, ref.schema ?? schema, ref.table)
            .then((response) => ({ key, columns: response.columns ?? [] }))
            .catch(() => ({ key, columns: [] as TDatabaseColumn[] }));
        }),
      ).then((results) => {
        results.forEach(({ key, columns }) => columnCacheRef.current.set(key, columns));
        setColumnsByTable(Object.fromEntries(columnCacheRef.current));
      });
    }, COLUMN_LOOKUP_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [connectionId, schema, sql]);

  return useMemo(() => {
    const keywordItems: TSqlSuggestionItem[] = SQL_KEYWORDS.map((text) => ({ text, kind: "keyword" }));
    const tableItems: TSqlSuggestionItem[] = tableNames.map((text) => ({ text, kind: "table" }));

    const seenColumns = new Set<string>();
    const columnItems: TSqlSuggestionItem[] = [];
    Object.values(columnsByTable).forEach((columns) => {
      columns.forEach((column) => {
        if (seenColumns.has(column.name)) return;
        seenColumns.add(column.name);
        columnItems.push({ text: column.name, kind: "column", detail: column.dataType });
      });
    });

    return [...columnItems, ...tableItems, ...keywordItems];
  }, [tableNames, columnsByTable]);
}
