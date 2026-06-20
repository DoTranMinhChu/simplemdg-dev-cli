import type { TDatabaseColumn, TDatabaseType, TSqlSafetyAnalysis } from "./db-types";

// Keywords blocked when the studio runs in read-only mode.
const READ_ONLY_BLOCKED_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "TRUNCATE",
  "ALTER",
  "CREATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
  "MERGE",
  "UPSERT",
];

// Statements that always warrant an explicit confirmation before running.
const DESTRUCTIVE_KEYWORDS = ["DROP", "TRUNCATE", "ALTER", "GRANT", "REVOKE"];

export function quoteIdentifier(_type: TDatabaseType, identifier: string): string {
  // Both HANA and PostgreSQL use double quotes for delimited identifiers and
  // escape an embedded double quote by doubling it.
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function buildQualifiedName(type: TDatabaseType, schema: string, name: string): string {
  if (!schema) {
    return quoteIdentifier(type, name);
  }

  return `${quoteIdentifier(type, schema)}.${quoteIdentifier(type, name)}`;
}

export function generateSelectSql(type: TDatabaseType, schema: string, table: string, limit = 100): string {
  return `SELECT * FROM ${buildQualifiedName(type, schema, table)} LIMIT ${limit}`;
}

export function generateCountSql(type: TDatabaseType, schema: string, table: string): string {
  return `SELECT COUNT(*) AS ROW_COUNT FROM ${buildQualifiedName(type, schema, table)}`;
}

function formatColumnType(column: TDatabaseColumn): string {
  const dataType = column.dataType.toUpperCase();

  if (column.length && /CHAR|VARCHAR|NVARCHAR|VARBINARY|BINARY/.test(dataType)) {
    return `${column.dataType}(${column.length})`;
  }

  if (column.scale != null && /DECIMAL|NUMERIC/.test(dataType)) {
    return `${column.dataType}(${column.length ?? 38},${column.scale})`;
  }

  return column.dataType;
}

/**
 * Best-effort CREATE TABLE statement reconstructed from column metadata. Useful
 * as a starting point for editing in the SQL console.
 */
export function generateCreateTableDdl(
  type: TDatabaseType,
  schema: string,
  table: string,
  columns: TDatabaseColumn[],
): string {
  const columnLines = columns.map((column) => {
    const nullable = column.nullable ? "" : " NOT NULL";
    const defaultValue = column.defaultValue ? ` DEFAULT ${column.defaultValue}` : "";
    return `  ${quoteIdentifier(type, column.name)} ${formatColumnType(column)}${nullable}${defaultValue}`;
  });

  const primaryKeyColumns = columns.filter((column) => column.isPrimaryKey).map((column) => quoteIdentifier(type, column.name));

  if (primaryKeyColumns.length > 0) {
    columnLines.push(`  PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
  }

  return `CREATE TABLE ${buildQualifiedName(type, schema, table)} (\n${columnLines.join(",\n")}\n);`;
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function getLeadingStatementKeyword(sql: string): string {
  const cleaned = stripSqlComments(sql).trim();
  const match = cleaned.match(/^([a-z]+)/i);
  return match ? match[1].toUpperCase() : "";
}

export function isSingleSelectStatement(sql: string): boolean {
  const cleaned = stripSqlComments(sql).trim().replace(/;\s*$/, "");
  if (cleaned.includes(";")) {
    return false;
  }

  const keyword = getLeadingStatementKeyword(cleaned);
  return keyword === "SELECT" || keyword === "WITH";
}

/**
 * Append a row limit to a single SELECT statement when one is not already
 * present, so accidental full-table scans stay bounded.
 */
export function appendSafeLimit(_type: TDatabaseType, sql: string, limit: number): string {
  if (limit <= 0) {
    return sql;
  }

  if (!isSingleSelectStatement(sql)) {
    return sql;
  }

  const cleaned = stripSqlComments(sql);

  if (/\blimit\s+\d+/i.test(cleaned) || /\btop\s+\d+/i.test(cleaned) || /\bfetch\s+first\b/i.test(cleaned)) {
    return sql;
  }

  const trimmed = sql.replace(/;\s*$/, "").trimEnd();
  return `${trimmed} LIMIT ${limit}`;
}

export function analyzeSqlSafety(sql: string, options: { readOnly: boolean }): TSqlSafetyAnalysis {
  const cleaned = stripSqlComments(sql).trim();
  const upper = cleaned.toUpperCase();
  const matchedKeywords: string[] = [];

  for (const keyword of READ_ONLY_BLOCKED_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(upper)) {
      matchedKeywords.push(keyword);
    }
  }

  const hasDestructiveKeyword = DESTRUCTIVE_KEYWORDS.some((keyword) => new RegExp(`\\b${keyword}\\b`).test(upper));
  const leadingKeyword = getLeadingStatementKeyword(cleaned);

  const isDeleteWithoutWhere = leadingKeyword === "DELETE" && !/\bWHERE\b/.test(upper);
  const isUpdateWithoutWhere = leadingKeyword === "UPDATE" && !/\bWHERE\b/.test(upper);

  const isDestructive = hasDestructiveKeyword || isDeleteWithoutWhere || isUpdateWithoutWhere;
  const isReadOnly = matchedKeywords.length === 0;
  const blockedByReadOnly = options.readOnly && matchedKeywords.length > 0;

  let reason: string | undefined;

  if (isDeleteWithoutWhere) {
    reason = "DELETE without a WHERE clause affects every row.";
  } else if (isUpdateWithoutWhere) {
    reason = "UPDATE without a WHERE clause affects every row.";
  } else if (hasDestructiveKeyword) {
    reason = `Statement contains a destructive keyword: ${matchedKeywords.filter((keyword) => DESTRUCTIVE_KEYWORDS.includes(keyword)).join(", ")}.`;
  }

  return {
    isDestructive,
    isReadOnly,
    blockedByReadOnly,
    matchedKeywords,
    reason,
  };
}

/**
 * Heuristic: an org or app name that looks production-like, used to warn the
 * developer before they connect.
 */
export function looksLikeProduction(...values: Array<string | undefined>): boolean {
  return values.some((value) => value && /\b(prod|production|prd|live)\b/i.test(value));
}
