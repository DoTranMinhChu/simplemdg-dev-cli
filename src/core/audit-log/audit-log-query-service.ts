import type { StudioConnectionPool } from "../db/db-connection";
import type { IDatabaseAdapter, TDatabaseQueryResult } from "../db/db-types";
import { analyzeSqlSafety } from "../db/db-metadata";
import type { TAuditLogDefinition } from "./audit-log-catalog";
import type { TResolvedAuditLogTable } from "./audit-log-table-resolver";

/**
 * Every query here is built with `adapter.runParameterized`/`adapter.placeholder`/
 * `adapter.quoteIdentifier` — never by concatenating a user-supplied value into SQL text. This is
 * a deliberate departure from `HanaAdapter.getTableData`'s free-text `where` (fine for an expert
 * driving DB Studio's SQL console by hand; not fine for a feature that automatically fans a typed
 * value out across many environments' tables). The only string-concatenated pieces are LIMIT/
 * OFFSET numbers, which are always `Number()`-coerced and clamped server-side first.
 */

function coerceNumber(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function coerceTimestamp(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export type TAuditLogStatusBreakdownEntry = { value: string; count: number };

export type TAuditLogTableStat = {
  schema: string;
  table: string;
  totalRows?: number;
  recentRows?: number;
  lastActivityAt?: string;
  statusBreakdown?: TAuditLogStatusBreakdownEntry[];
  error?: string;
};

export type TAuditLogStatCell = {
  catalogId: string;
  tables: TAuditLogTableStat[];
  totalRows: number;
  recentRows?: number;
  lastActivityAt?: string;
  errorCount: number;
  statusBreakdown?: TAuditLogStatusBreakdownEntry[];
};

const STATUS_BREAKDOWN_LIMIT = 20;

/**
 * The catalog's declared `timestampColumn`/`statusColumn` values are written in the CDS model's own
 * camelCase (e.g. `createdAt`, `action`) — but HANA uppercases unquoted CDS element names when
 * materializing physical columns, so a quoted, case-preserved reference like `"action"` doesn't
 * match the real stored `"ACTION"` (confirmed live: HANA rejects it with "invalid column name").
 * Postgres CDS deployments, by contrast, typically preserve exact case via quoted identifiers, so
 * the as-declared casing usually already works there. Try as-declared first, then fall back to
 * uppercase — covers both without the query layer needing to know which adapter type it's talking to.
 */
async function runWithColumnCaseFallback<T>(adapter: IDatabaseAdapter, columnName: string, run: (quotedColumn: string) => Promise<T>): Promise<T> {
  try {
    return await run(adapter.quoteIdentifier(columnName));
  } catch (error) {
    const upper = columnName.toUpperCase();
    if (upper === columnName) throw error;
    return await run(adapter.quoteIdentifier(upper));
  }
}

/** Low-cardinality enum-like status/action column expected — capped, so this never fans out into a huge distinct-value scan. */
async function statusBreakdownForTable(
  adapter: IDatabaseAdapter,
  table: TResolvedAuditLogTable,
  statusColumn: string,
): Promise<TAuditLogStatusBreakdownEntry[] | undefined> {
  const qualified = adapter.buildQualifiedName(table.schema, table.name);
  try {
    const result = await runWithColumnCaseFallback(adapter, statusColumn, (column) =>
      adapter.runQuery(
        `SELECT ${column} AS STATUS_VALUE, COUNT(*) AS CNT FROM ${qualified} GROUP BY ${column} ORDER BY CNT DESC LIMIT ${STATUS_BREAKDOWN_LIMIT}`,
        { maxRows: STATUS_BREAKDOWN_LIMIT },
      ),
    );
    return result.rows.map((row) => ({
      value: String(row.STATUS_VALUE ?? row.status_value ?? ""),
      count: coerceNumber(row.CNT ?? row.cnt),
    }));
  } catch {
    // The catalog's declared statusColumn may not match this environment's actual schema.
    return undefined;
  }
}

/**
 * Sums counts for the same status value across every resolved table (relevant for `multiTable`
 * entries), sorts descending, caps at `limit`. Known tradeoff: each table's own breakdown is
 * already capped to its top 20, so a value that ranks outside the top 20 in every individual table
 * but would rank in the merged top 20 overall gets under-counted. Acceptable since these are
 * expected to be low-cardinality enum-like columns.
 */
export function mergeStatusBreakdowns(
  perTable: Array<TAuditLogStatusBreakdownEntry[] | undefined>,
  limit = STATUS_BREAKDOWN_LIMIT,
): TAuditLogStatusBreakdownEntry[] | undefined {
  const present = perTable.filter((list): list is TAuditLogStatusBreakdownEntry[] => Boolean(list));
  if (!present.length) return undefined;
  const totals = new Map<string, number>();
  for (const list of present) {
    for (const entry of list) totals.set(entry.value, (totals.get(entry.value) ?? 0) + entry.count);
  }
  return Array.from(totals, ([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** ISO timestamps. `since`/`until` are each optional independently — a UI "last N hours/days" mode only ever sets `since`; "custom range" can set either or both. */
export type TAuditLogStatsWindow = { since?: string; until?: string };

async function statTable(
  adapter: IDatabaseAdapter,
  table: TResolvedAuditLogTable,
  definition: Pick<TAuditLogDefinition, "timestampColumn" | "statusColumn">,
  window: TAuditLogStatsWindow,
): Promise<TAuditLogTableStat> {
  const qualified = adapter.buildQualifiedName(table.schema, table.name);

  try {
    const totalResult = await adapter.runQuery(`SELECT COUNT(*) AS CNT FROM ${qualified}`, { maxRows: 1 });
    const totalRow = totalResult.rows[0] ?? {};
    const totalRows = coerceNumber(totalRow.CNT ?? totalRow.cnt);

    let recentRows: number | undefined;
    let lastActivityAt: string | undefined;

    if (definition.timestampColumn && (window.since || window.until)) {
      try {
        const recentResult = await runWithColumnCaseFallback(adapter, definition.timestampColumn, (column) => {
          const clauses: string[] = [];
          const params: unknown[] = [];
          if (window.since) {
            clauses.push(`${column} >= ${adapter.placeholder(params.length + 1)}`);
            params.push(window.since);
          }
          if (window.until) {
            clauses.push(`${column} <= ${adapter.placeholder(params.length + 1)}`);
            params.push(window.until);
          }
          return adapter.runParameterized(
            `SELECT COUNT(*) AS CNT, MAX(${column}) AS LAST_TS FROM ${qualified} WHERE ${clauses.join(" AND ")}`,
            params,
            { maxRows: 1 },
          );
        });
        const recentRow = recentResult.rows[0] ?? {};
        recentRows = coerceNumber(recentRow.CNT ?? recentRow.cnt);
        lastActivityAt = coerceTimestamp(recentRow.LAST_TS ?? recentRow.last_ts);
      } catch {
        // The catalog's declared timestamp column may not match this environment's actual
        // schema (staging/final variant, client customization) — the total count is still valid.
      }
    }

    const statusBreakdown = definition.statusColumn ? await statusBreakdownForTable(adapter, table, definition.statusColumn) : undefined;

    return { schema: table.schema, table: table.name, totalRows, recentRows, lastActivityAt, statusBreakdown };
  } catch (error) {
    return { schema: table.schema, table: table.name, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Stats for one catalog entry in one environment. `tables` may be >1 for `multiTable` (master-data-domain) entries. */
export async function queryStatsForDefinition(
  connectionId: string,
  pool: StudioConnectionPool,
  definition: TAuditLogDefinition,
  tables: TResolvedAuditLogTable[],
  options: TAuditLogStatsWindow,
): Promise<TAuditLogStatCell> {
  if (!tables.length) {
    return { catalogId: definition.id, tables: [], totalRows: 0, errorCount: 0 };
  }

  const tableStats = await pool.runWithAdapter(
    connectionId,
    (adapter) => Promise.all(tables.map((table) => statTable(adapter, table, definition, options))),
    { retryReadOnlyOnNetworkError: true },
  );

  const totalRows = tableStats.reduce((sum, stat) => sum + (stat.totalRows ?? 0), 0);
  const recentRowsList = tableStats.map((stat) => stat.recentRows).filter((value): value is number => value !== undefined);
  const recentRows = recentRowsList.length ? recentRowsList.reduce((sum, value) => sum + value, 0) : undefined;
  const lastActivityAt = tableStats
    .map((stat) => stat.lastActivityAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .pop();
  const errorCount = tableStats.filter((stat) => stat.error).length;
  const statusBreakdown = mergeStatusBreakdowns(tableStats.map((stat) => stat.statusBreakdown));

  return { catalogId: definition.id, tables: tableStats, totalRows, recentRows, lastActivityAt, errorCount, statusBreakdown };
}

export type TAuditLogTraceRow = {
  catalogId: string;
  displayName: string;
  schema: string;
  table: string;
  timestampColumn?: string;
  row: Record<string, unknown>;
};

/** Trace one correlation value across every resolved table for one catalog entry. Tables missing the correlation column are skipped, not fatal. */
export async function queryTraceForDefinition(
  connectionId: string,
  pool: StudioConnectionPool,
  definition: TAuditLogDefinition,
  tables: TResolvedAuditLogTable[],
  correlationColumn: string,
  correlationValue: string,
): Promise<TAuditLogTraceRow[]> {
  if (!tables.length) return [];

  const rowsByTable = await pool.runWithAdapter(
    connectionId,
    (adapter) =>
      Promise.all(
        tables.map(async (table) => {
          const qualified = adapter.buildQualifiedName(table.schema, table.name);
          const column = adapter.quoteIdentifier(correlationColumn);
          try {
            const result = await adapter.runParameterized(
              `SELECT * FROM ${qualified} WHERE ${column} = ${adapter.placeholder(1)}`,
              [correlationValue],
              { maxRows: 200 },
            );
            return result.rows.map((row) => ({
              catalogId: definition.id,
              displayName: definition.displayName,
              schema: table.schema,
              table: table.name,
              timestampColumn: definition.timestampColumn,
              row,
            }));
          } catch {
            return [];
          }
        }),
      ),
    { retryReadOnlyOnNetworkError: true },
  );

  return rowsByTable.flat();
}

export type TAuditLogDetailFilterOp = "eq" | "contains" | "gte" | "lte";
export type TAuditLogDetailFilter = { column: string; op: TAuditLogDetailFilterOp; value: string };

function buildWhereClause(adapter: IDatabaseAdapter, filters: TAuditLogDetailFilter[], rawWhere?: string): { whereSql: string; params: unknown[] } {
  if (rawWhere && rawWhere.trim()) {
    return { whereSql: ` WHERE (${rawWhere.trim()})`, params: [] };
  }
  const params: unknown[] = [];
  const clauses = filters
    .filter((filter) => filter.value !== undefined && filter.value !== "")
    .map((filter) => {
      const column = adapter.quoteIdentifier(filter.column);
      if (filter.op === "contains") {
        params.push(`%${filter.value}%`);
        return `${column} LIKE ${adapter.placeholder(params.length)}`;
      }
      params.push(filter.value);
      const operator = filter.op === "gte" ? ">=" : filter.op === "lte" ? "<=" : "=";
      return `${column} ${operator} ${adapter.placeholder(params.length)}`;
    });
  return { whereSql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", params };
}

/**
 * "Advanced" raw-WHERE mode for Detail Viewer filters — an opt-in escape hatch alongside the
 * default structured-filter rows (which stay fully parameterized). Deliberately a bit stricter
 * than DB Studio's own free-text WHERE (`HanaAdapter`/`PostgresAdapter.getTableData`'s `where`
 * option, which has zero validation): semicolons and any read-only-blocked/destructive keyword are
 * rejected before the fragment is ever interpolated into SQL.
 */
export function validateRawWhere(rawWhere: string): { ok: true } | { ok: false; error: string } {
  const trimmed = rawWhere.trim();
  if (!trimmed) return { ok: false, error: "rawWhere is empty" };
  if (trimmed.includes(";")) return { ok: false, error: "Semicolons are not allowed in an Advanced WHERE fragment." };
  const safety = analyzeSqlSafety(`SELECT 1 FROM X WHERE ${trimmed}`, { readOnly: true });
  if (safety.blockedByReadOnly || safety.isDestructive) {
    return { ok: false, error: `Advanced WHERE fragment contains a blocked keyword: ${safety.matchedKeywords.join(", ") || "destructive statement"}` };
  }
  return { ok: true };
}

/**
 * Retries a structured-filter query once with every filter's column uppercased if the first
 * attempt fails — the same HANA case-sensitivity issue `runWithColumnCaseFallback` handles for
 * stats (catalog/Stats-click-through-declared column names are camelCase; HANA stores them
 * uppercased). Not applied to `rawWhere`, since that's already opaque, user-typed SQL text — there's
 * no single "column" to re-case.
 */
async function runDetailQueryWithCaseFallback<T>(
  adapter: IDatabaseAdapter,
  filters: TAuditLogDetailFilter[],
  rawWhere: string | undefined,
  run: (whereSql: string, params: unknown[]) => Promise<T>,
): Promise<T> {
  const first = buildWhereClause(adapter, filters, rawWhere);
  try {
    return await run(first.whereSql, first.params);
  } catch (error) {
    if (rawWhere || !filters.length) throw error;
    const upperFilters = filters.map((filter) => ({ ...filter, column: filter.column.toUpperCase() }));
    if (upperFilters.every((filter, index) => filter.column === filters[index].column)) throw error;
    const retry = buildWhereClause(adapter, upperFilters, rawWhere);
    return await run(retry.whereSql, retry.params);
  }
}

export async function queryDetailTable(
  connectionId: string,
  pool: StudioConnectionPool,
  table: { schema: string; name: string },
  options: { limit: number; offset: number; filters: TAuditLogDetailFilter[]; rawWhere?: string; orderBy?: string; orderDirection?: "asc" | "desc" },
): Promise<TDatabaseQueryResult> {
  return pool.runWithAdapter(
    connectionId,
    (adapter) => {
      const qualified = adapter.buildQualifiedName(table.schema, table.name);
      const orderSql = options.orderBy ? ` ORDER BY ${adapter.quoteIdentifier(options.orderBy)} ${options.orderDirection === "desc" ? "DESC" : "ASC"}` : "";
      const limit = Math.max(1, Math.min(Math.trunc(options.limit) || 100, 1000));
      const offset = Math.max(0, Math.trunc(options.offset) || 0);
      return runDetailQueryWithCaseFallback(adapter, options.filters, options.rawWhere, (whereSql, params) =>
        adapter.runParameterized(`SELECT * FROM ${qualified}${whereSql}${orderSql} LIMIT ${limit} OFFSET ${offset}`, params),
      );
    },
    { retryReadOnlyOnNetworkError: true },
  );
}

export async function countDetailTable(
  connectionId: string,
  pool: StudioConnectionPool,
  table: { schema: string; name: string },
  filters: TAuditLogDetailFilter[],
  rawWhere?: string,
): Promise<number> {
  const result = await pool.runWithAdapter(
    connectionId,
    (adapter) => {
      const qualified = adapter.buildQualifiedName(table.schema, table.name);
      return runDetailQueryWithCaseFallback(adapter, filters, rawWhere, (whereSql, params) =>
        adapter.runParameterized(`SELECT COUNT(*) AS CNT FROM ${qualified}${whereSql}`, params, { maxRows: 1 }),
      );
    },
    { retryReadOnlyOnNetworkError: true },
  );
  const row = result.rows[0] ?? {};
  return coerceNumber(row.CNT ?? row.cnt);
}
