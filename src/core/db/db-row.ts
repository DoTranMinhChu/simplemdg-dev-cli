import type {
  IDatabaseAdapter,
  TDatabaseQueryResult,
  TSaveRowResult,
  TSaveTableChangesResult,
  TTableChangeSet,
} from "./db-types";

export type TRowValues = Record<string, unknown>;

function ensureKeyColumns(keys: TRowValues): string[] {
  const columns = Object.keys(keys);

  if (columns.length === 0) {
    throw new Error("Cannot identify the row: the table has no primary key. Edit it from the SQL Console instead.");
  }

  return columns;
}

/**
 * Build and run a parameterized UPDATE that targets exactly one row using its
 * key columns. Values are passed as bind parameters, never string-interpolated.
 */
export async function updateRow(
  adapter: IDatabaseAdapter,
  options: { schema: string; table: string; changes: TRowValues; keys: TRowValues },
): Promise<TDatabaseQueryResult> {
  const changeColumns = Object.keys(options.changes);

  if (changeColumns.length === 0) {
    throw new Error("No changes to save.");
  }

  const keyColumns = ensureKeyColumns(options.keys);
  const params: unknown[] = [];
  let position = 1;

  const setClause = changeColumns
    .map((column) => {
      params.push(options.changes[column]);
      return `${adapter.quoteIdentifier(column)} = ${adapter.placeholder(position++)}`;
    })
    .join(", ");

  const whereClause = keyColumns
    .map((column) => {
      params.push(options.keys[column]);
      return `${adapter.quoteIdentifier(column)} = ${adapter.placeholder(position++)}`;
    })
    .join(" AND ");

  const sql = `UPDATE ${adapter.buildQualifiedName(options.schema, options.table)} SET ${setClause} WHERE ${whereClause}`;
  return adapter.runParameterized(sql, params);
}

export async function deleteRow(
  adapter: IDatabaseAdapter,
  options: { schema: string; table: string; keys: TRowValues },
): Promise<TDatabaseQueryResult> {
  const keyColumns = ensureKeyColumns(options.keys);
  const params: unknown[] = [];
  let position = 1;

  const whereClause = keyColumns
    .map((column) => {
      params.push(options.keys[column]);
      return `${adapter.quoteIdentifier(column)} = ${adapter.placeholder(position++)}`;
    })
    .join(" AND ");

  const sql = `DELETE FROM ${adapter.buildQualifiedName(options.schema, options.table)} WHERE ${whereClause}`;
  return adapter.runParameterized(sql, params);
}

export async function insertRow(
  adapter: IDatabaseAdapter,
  options: { schema: string; table: string; values: TRowValues },
): Promise<TDatabaseQueryResult> {
  const columns = Object.keys(options.values);

  if (columns.length === 0) {
    throw new Error("No values to insert.");
  }

  const params: unknown[] = [];
  let position = 1;

  const columnClause = columns.map((column) => adapter.quoteIdentifier(column)).join(", ");
  const valueClause = columns
    .map((column) => {
      params.push(options.values[column]);
      return adapter.placeholder(position++);
    })
    .join(", ");

  const sql = `INSERT INTO ${adapter.buildQualifiedName(options.schema, options.table)} (${columnClause}) VALUES (${valueClause})`;
  return adapter.runParameterized(sql, params);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Apply a set of pending grid changes. Each change runs independently so a
 * single failing row does not discard the others — the result reports per-row
 * success/failure, and callers keep the failed rows pending.
 */
export async function saveTableChanges(
  adapter: IDatabaseAdapter,
  changeSet: TTableChangeSet,
): Promise<TSaveTableChangesResult> {
  const rowResults: TSaveRowResult[] = [];
  const { schema, table } = changeSet;
  let updated = 0;
  let inserted = 0;
  let deleted = 0;

  for (const update of changeSet.updates) {
    try {
      await updateRow(adapter, { schema, table, changes: update.changes, keys: update.key });
      updated += 1;
      rowResults.push({ type: "update", success: true, key: update.key });
    } catch (error) {
      rowResults.push({ type: "update", success: false, key: update.key, error: errorMessage(error) });
    }
  }

  for (const insert of changeSet.inserts) {
    try {
      await insertRow(adapter, { schema, table, values: insert.values });
      inserted += 1;
      rowResults.push({ type: "insert", success: true });
    } catch (error) {
      rowResults.push({ type: "insert", success: false, error: errorMessage(error) });
    }
  }

  for (const remove of changeSet.deletes) {
    try {
      await deleteRow(adapter, { schema, table, keys: remove.key });
      deleted += 1;
      rowResults.push({ type: "delete", success: true, key: remove.key });
    } catch (error) {
      rowResults.push({ type: "delete", success: false, key: remove.key, error: errorMessage(error) });
    }
  }

  return {
    success: rowResults.every((result) => result.success),
    updated,
    inserted,
    deleted,
    rowResults,
  };
}
