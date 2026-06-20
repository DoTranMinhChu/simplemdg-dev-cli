import { buildQualifiedName, quoteIdentifier } from "../db-metadata";
import type { TDatabaseColumn, TDatabaseType, TGridSortState } from "../db-types";

const CLAUSE_KEYWORDS = [
  "select", "from", "where", "group by", "having", "order by", "limit", "offset",
  "union all", "union", "left join", "right join", "inner join", "full join", "join", "on",
  "insert into", "values", "update", "set", "delete from", "create table", "alter table",
];

/** Lightweight SQL pretty printer: uppercases clause keywords and breaks lines. */
export function formatSql(sql: string): string {
  let text = sql.replace(/\s+/g, " ").trim();

  for (const keyword of CLAUSE_KEYWORDS) {
    const pattern = new RegExp(`\\s*\\b${keyword.replace(/ /g, "\\s+")}\\b\\s*`, "gi");
    text = text.replace(pattern, (match) => {
      const upper = keyword.toUpperCase();
      const isJoinOrOn = /join|^on$/i.test(keyword);
      return (isJoinOrOn ? "\n  " : "\n") + upper + " ";
    });
  }

  return text.replace(/\n\s*\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

export type TStatementRange = { sql: string; start: number; end: number };

/** Split SQL into statements on `;`, ignoring semicolons inside strings/comments. */
export function splitStatementRanges(sql: string): TStatementRange[] {
  const ranges: TStatementRange[] = [];
  let buffer = "";
  let bufferStart = -1;
  let inString = false;
  let quote = "";
  let inLine = false;
  let inBlock = false;

  const push = (endIndex: number): void => {
    if (buffer.trim()) {
      ranges.push({ sql: buffer.trim(), start: bufferStart, end: endIndex });
    }
    buffer = "";
    bufferStart = -1;
  };

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (bufferStart === -1 && !/\s/.test(ch)) {
      bufferStart = i;
    }

    if (inLine) {
      buffer += ch;
      if (ch === "\n") inLine = false;
      continue;
    }
    if (inBlock) {
      buffer += ch;
      if (ch === "*" && next === "/") { buffer += next; i += 1; inBlock = false; }
      continue;
    }
    if (inString) {
      buffer += ch;
      if (ch === quote) inString = false;
      continue;
    }
    if (ch === "-" && next === "-") { inLine = true; buffer += ch; continue; }
    if (ch === "/" && next === "*") { inBlock = true; buffer += ch; continue; }
    if (ch === "'" || ch === '"') { inString = true; quote = ch; buffer += ch; continue; }
    if (ch === ";") { push(i); continue; }
    buffer += ch;
  }

  push(sql.length);
  return ranges;
}

export function splitStatements(sql: string): string[] {
  return splitStatementRanges(sql).map((range) => range.sql);
}

/** The statement that contains the given cursor offset (for "Run current statement"). */
export function statementAtOffset(sql: string, offset: number): string {
  const ranges = splitStatementRanges(sql);
  const hit = ranges.find((range) => offset >= range.start && offset <= range.end + 1);
  return (hit ?? ranges[ranges.length - 1])?.sql ?? sql.trim();
}

export type TGenerateTableQueryInput = {
  type: TDatabaseType;
  schema: string;
  table: string;
  where?: string;
  sort?: TGridSortState[];
  limit?: number;
  offset?: number;
};

export function generateTableQuery(input: TGenerateTableQueryInput): string {
  const qualified = buildQualifiedName(input.type, input.schema, input.table);
  const lines = ["SELECT *", `FROM ${qualified}`];

  if (input.where && input.where.trim()) {
    lines.push(`WHERE ${input.where.trim()}`);
  }

  if (input.sort && input.sort.length > 0) {
    const order = input.sort
      .map((sort) => `${quoteIdentifier(input.type, sort.column)} ${sort.direction === "desc" ? "DESC" : "ASC"}`)
      .join(", ");
    lines.push(`ORDER BY ${order}`);
  }

  if (input.limit && input.limit > 0) {
    lines.push(`LIMIT ${input.limit}`);
    lines.push(`OFFSET ${input.offset ?? 0}`);
  }

  return `${lines.join("\n")};`;
}

export function generateInsertTemplate(type: TDatabaseType, schema: string, table: string, columns: TDatabaseColumn[]): string {
  const cols = columns.length > 0 ? columns : [{ name: "column1" } as TDatabaseColumn, { name: "column2" } as TDatabaseColumn];
  const colNames = cols.map((column) => quoteIdentifier(type, column.name));
  const placeholders = cols.map((column) => `<${column.name}>`);
  return `INSERT INTO ${buildQualifiedName(type, schema, table)} (\n  ${colNames.join(", ")}\n) VALUES (\n  ${placeholders.join(", ")}\n);`;
}

export function generateUpdateTemplate(type: TDatabaseType, schema: string, table: string, columns: TDatabaseColumn[], primaryKey: string[]): string {
  const keyCols = primaryKey.length > 0 ? primaryKey : columns.slice(0, 1).map((column) => column.name);
  const setCols = columns.filter((column) => !keyCols.includes(column.name));
  const setClause = (setCols.length > 0 ? setCols : columns)
    .map((column) => `${quoteIdentifier(type, column.name)} = <${column.name}>`)
    .join(",\n  ");
  const whereClause = keyCols.map((column) => `${quoteIdentifier(type, column)} = <${column}>`).join("\n  AND ");
  return `UPDATE ${buildQualifiedName(type, schema, table)}\nSET\n  ${setClause}\nWHERE\n  ${whereClause};`;
}
