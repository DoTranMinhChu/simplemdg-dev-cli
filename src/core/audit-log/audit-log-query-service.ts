import type { StudioConnectionPool } from "../db/db-connection";
import type { IDatabaseAdapter, TDatabaseQueryResult } from "../db/db-types";
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

export type TAuditLogTableStat = {
  schema: string;
  table: string;
  totalRows?: number;
  recentRows?: number;
  lastActivityAt?: string;
  error?: string;
};

export type TAuditLogStatCell = {
  catalogId: string;
  tables: TAuditLogTableStat[];
  totalRows: number;
  recentRows?: number;
  lastActivityAt?: string;
  errorCount: number;
};

async function statTable(
  adapter: IDatabaseAdapter,
  table: TResolvedAuditLogTable,
  timestampColumn: string | undefined,
  sinceHours: number,
): Promise<TAuditLogTableStat> {
  const qualified = adapter.buildQualifiedName(table.schema, table.name);

  try {
    const totalResult = await adapter.runQuery(`SELECT COUNT(*) AS CNT FROM ${qualified}`, { maxRows: 1 });
    const totalRow = totalResult.rows[0] ?? {};
    const totalRows = coerceNumber(totalRow.CNT ?? totalRow.cnt);

    let recentRows: number | undefined;
    let lastActivityAt: string | undefined;

    if (timestampColumn) {
      try {
        const column = adapter.quoteIdentifier(timestampColumn);
        const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();
        const recentResult = await adapter.runParameterized(
          `SELECT COUNT(*) AS CNT, MAX(${column}) AS LAST_TS FROM ${qualified} WHERE ${column} >= ${adapter.placeholder(1)}`,
          [since],
          { maxRows: 1 },
        );
        const recentRow = recentResult.rows[0] ?? {};
        recentRows = coerceNumber(recentRow.CNT ?? recentRow.cnt);
        lastActivityAt = coerceTimestamp(recentRow.LAST_TS ?? recentRow.last_ts);
      } catch {
        // The catalog's declared timestamp column may not match this environment's actual
        // schema (staging/final variant, client customization) — the total count is still valid.
      }
    }

    return { schema: table.schema, table: table.name, totalRows, recentRows, lastActivityAt };
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
  options: { sinceHours: number },
): Promise<TAuditLogStatCell> {
  if (!tables.length) {
    return { catalogId: definition.id, tables: [], totalRows: 0, errorCount: 0 };
  }

  const tableStats = await pool.runWithAdapter(
    connectionId,
    (adapter) => Promise.all(tables.map((table) => statTable(adapter, table, definition.timestampColumn, options.sinceHours))),
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

  return { catalogId: definition.id, tables: tableStats, totalRows, recentRows, lastActivityAt, errorCount };
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

function buildWhereClause(adapter: IDatabaseAdapter, filters: TAuditLogDetailFilter[]): { whereSql: string; params: unknown[] } {
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

export async function queryDetailTable(
  connectionId: string,
  pool: StudioConnectionPool,
  table: { schema: string; name: string },
  options: { limit: number; offset: number; filters: TAuditLogDetailFilter[]; orderBy?: string; orderDirection?: "asc" | "desc" },
): Promise<TDatabaseQueryResult> {
  return pool.runWithAdapter(
    connectionId,
    (adapter) => {
      const qualified = adapter.buildQualifiedName(table.schema, table.name);
      const { whereSql, params } = buildWhereClause(adapter, options.filters);
      const orderSql = options.orderBy ? ` ORDER BY ${adapter.quoteIdentifier(options.orderBy)} ${options.orderDirection === "desc" ? "DESC" : "ASC"}` : "";
      const limit = Math.max(1, Math.min(Math.trunc(options.limit) || 100, 1000));
      const offset = Math.max(0, Math.trunc(options.offset) || 0);
      const sql = `SELECT * FROM ${qualified}${whereSql}${orderSql} LIMIT ${limit} OFFSET ${offset}`;
      return adapter.runParameterized(sql, params);
    },
    { retryReadOnlyOnNetworkError: true },
  );
}

export async function countDetailTable(
  connectionId: string,
  pool: StudioConnectionPool,
  table: { schema: string; name: string },
  filters: TAuditLogDetailFilter[],
): Promise<number> {
  const result = await pool.runWithAdapter(
    connectionId,
    (adapter) => {
      const qualified = adapter.buildQualifiedName(table.schema, table.name);
      const { whereSql, params } = buildWhereClause(adapter, filters);
      return adapter.runParameterized(`SELECT COUNT(*) AS CNT FROM ${qualified}${whereSql}`, params, { maxRows: 1 });
    },
    { retryReadOnlyOnNetworkError: true },
  );
  const row = result.rows[0] ?? {};
  return coerceNumber(row.CNT ?? row.cnt);
}
