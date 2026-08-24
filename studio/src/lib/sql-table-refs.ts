export type TSqlTableRef = { schema?: string; table: string };

const IDENT = `"?[A-Za-z_][A-Za-z0-9_]*"?`;
const TABLE_REF_RE = new RegExp(`\\b(?:FROM|JOIN)\\s+(${IDENT}(?:\\.${IDENT})?)`, "gi");

function stripQuotes(part: string): string {
  return part.replace(/^"|"$/g, "");
}

/**
 * Best-effort extraction of the tables a free-typed SQL query references, via its FROM/JOIN
 * clauses — used to scope column autocomplete to only the tables actually in play, instead of
 * flooding suggestions with every column in the schema. Not a real parser: it can't see past a
 * subquery into its outer table, doesn't resolve CTEs, and treats a schema-qualified
 * `SCHEMA.TABLE` the same as any other dotted identifier pair. Good enough for "what table did
 * they just type after FROM" autocomplete scoping — not for validating the SQL.
 */
export function extractReferencedTables(sql: string): TSqlTableRef[] {
  const seen = new Set<string>();
  const refs: TSqlTableRef[] = [];
  for (const match of sql.matchAll(TABLE_REF_RE)) {
    const parts = match[1].split(".").map(stripQuotes);
    const ref: TSqlTableRef = parts.length === 2 ? { schema: parts[0], table: parts[1] } : { table: parts[0] };
    const key = `${ref.schema ?? ""}.${ref.table}`.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
}
