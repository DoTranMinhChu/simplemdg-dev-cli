import type { Client as PgClient, QueryResult } from "pg";
import { buildQualifiedName, quoteIdentifier } from "./db-metadata";
import { classifyDatabaseError } from "./db-error";
import type {
  IDatabaseAdapter,
  TConnectionTestResult,
  TDatabaseColumn,
  TDatabaseErrorInfo,
  TDatabaseIndex,
  TDatabaseObject,
  TDatabaseQueryResult,
  TDatabaseSchema,
  TDatabaseType,
  TListObjectsOptions,
  TResolvedDatabaseConnection,
  TTableDataOptions,
} from "./db-types";

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

type TPgRow = Record<string, unknown>;

export class PostgresAdapter implements IDatabaseAdapter {
  public readonly type: TDatabaseType = "postgresql";

  private client: PgClient | undefined;

  private readonly queryTimeoutMs: number;

  constructor(
    private readonly connection: TResolvedDatabaseConnection,
    options?: { queryTimeoutMs?: number },
  ) {
    this.queryTimeoutMs = options?.queryTimeoutMs ?? 30000;
  }

  public async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    let pgModule: typeof import("pg");

    try {
      pgModule = await import("pg");
    } catch {
      throw new Error("PostgreSQL driver 'pg' is not installed. Run: npm install pg");
    }

    const PgClientCtor = pgModule.Client ?? (pgModule as unknown as { default: typeof import("pg") }).default.Client;
    const client = new PgClientCtor({
      host: this.connection.host,
      port: this.connection.port,
      user: this.connection.username,
      password: this.connection.password,
      database: this.connection.database,
      ssl: this.connection.ssl ? { rejectUnauthorized: this.connection.sslValidateCertificate ?? false } : undefined,
      statement_timeout: this.queryTimeoutMs,
      connectionTimeoutMillis: 15000,
    });

    await client.connect();
    this.client = client;
  }

  public async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end().catch(() => undefined);
      this.client = undefined;
    }
  }

  private async getClient(): Promise<PgClient> {
    if (!this.client) {
      await this.connect();
    }

    if (!this.client) {
      throw new Error("PostgreSQL connection is not established");
    }

    return this.client;
  }

  public async isConnected(): Promise<boolean> {
    if (!this.client) {
      return false;
    }
    try {
      await this.client.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  public async reconnect(): Promise<void> {
    await this.disconnect().catch(() => undefined);
    await this.connect();
  }

  public classifyError(error: unknown): TDatabaseErrorInfo {
    return classifyDatabaseError(error, this.type);
  }

  public async testConnection(): Promise<TConnectionTestResult> {
    const startedAt = Date.now();

    try {
      const client = await this.getClient();
      const result = await client.query("SELECT version() AS version");
      const version = String((result.rows[0] as TPgRow | undefined)?.version ?? "PostgreSQL");
      return { success: true, message: "Connection successful", serverVersion: version, durationMs: Date.now() - startedAt };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private toQueryResult(result: QueryResult, durationMs: number, maxRows?: number): TDatabaseQueryResult {
    const fields = (result.fields ?? []).map((field) => field.name);
    const allRows = (result.rows ?? []) as TPgRow[];
    const limit = maxRows ?? 0;
    const truncated = limit > 0 && allRows.length > limit;
    const rows = truncated ? allRows.slice(0, limit) : allRows;
    const command = result.command;
    const isSelect = command === "SELECT" || command === "SHOW";

    return {
      fields: fields.length > 0 ? fields : rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
      affectedRows: isSelect ? undefined : result.rowCount ?? undefined,
      command,
      durationMs,
      truncated,
    };
  }

  public async runQuery(sql: string, options?: { maxRows?: number }): Promise<TDatabaseQueryResult> {
    const client = await this.getClient();
    const startedAt = Date.now();
    const rawResult = await client.query(sql);
    const result = Array.isArray(rawResult) ? rawResult[rawResult.length - 1] as QueryResult : rawResult as QueryResult;
    return this.toQueryResult(result, Date.now() - startedAt, options?.maxRows);
  }

  public async runParameterized(sql: string, params: unknown[], options?: { maxRows?: number }): Promise<TDatabaseQueryResult> {
    const client = await this.getClient();
    const startedAt = Date.now();
    const result = await client.query(sql, params) as QueryResult;
    return this.toQueryResult(result, Date.now() - startedAt, options?.maxRows);
  }

  public placeholder(index: number): string {
    return `$${index}`;
  }

  public async listSchemas(): Promise<TDatabaseSchema[]> {
    const client = await this.getClient();
    const result = await client.query("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name");
    return (result.rows as TPgRow[]).map((row) => {
      const name = String(row.schema_name);
      return { name, isSystem: SYSTEM_SCHEMAS.has(name) || name.startsWith("pg_") };
    });
  }

  public async listObjects(options: TListObjectsOptions): Promise<TDatabaseObject[]> {
    const client = await this.getClient();
    const schema = options.schema;
    const kinds = options.kinds;
    const objects: TDatabaseObject[] = [];

    if (!schema) {
      return objects;
    }

    const wantsTable = !kinds || kinds.includes("table");
    const wantsView = !kinds || kinds.includes("view");
    const wantsFunction = !kinds || kinds.includes("function") || kinds.includes("procedure");

    if (wantsTable || wantsView) {
      const tables = await client.query(
        "SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
        [schema],
      );

      for (const row of tables.rows as TPgRow[]) {
        const isView = String(row.table_type) === "VIEW";
        if (isView && !wantsView) continue;
        if (!isView && !wantsTable) continue;
        objects.push({ schema, name: String(row.table_name), kind: isView ? "view" : "table", type: String(row.table_type) });
      }
    }

    if (wantsFunction) {
      const routines = await client.query(
        "SELECT routine_name, routine_type FROM information_schema.routines WHERE routine_schema = $1 ORDER BY routine_name",
        [schema],
      );

      for (const row of routines.rows as TPgRow[]) {
        const isProcedure = String(row.routine_type) === "PROCEDURE";
        objects.push({ schema, name: String(row.routine_name), kind: isProcedure ? "procedure" : "function", type: String(row.routine_type) });
      }
    }

    const search = options.search?.trim().toLowerCase();
    return search ? objects.filter((object) => object.name.toLowerCase().includes(search)) : objects;
  }

  public async listColumns(schema: string, table: string): Promise<TDatabaseColumn[]> {
    const client = await this.getClient();
    const columnsResult = await client.query(
      `SELECT c.column_name, c.data_type, c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.is_nullable, c.column_default, c.ordinal_position,
              (SELECT pgd.description
                 FROM pg_catalog.pg_description pgd
                 JOIN pg_catalog.pg_class cls ON cls.oid = pgd.objoid
                 JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
                WHERE ns.nspname = c.table_schema AND cls.relname = c.table_name AND pgd.objsubid = c.ordinal_position) AS column_comment
       FROM information_schema.columns c
       WHERE c.table_schema = $1 AND c.table_name = $2
       ORDER BY c.ordinal_position`,
      [schema, table],
    );

    const primaryKeyResult = await client.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
      [schema, table],
    );

    const primaryKeyColumns = new Set((primaryKeyResult.rows as TPgRow[]).map((row) => String(row.column_name)));

    return (columnsResult.rows as TPgRow[]).map((row) => ({
      name: String(row.column_name),
      dataType: String(row.data_type),
      length: row.character_maximum_length === null ? undefined : Number(row.character_maximum_length),
      scale: row.numeric_scale === null ? undefined : Number(row.numeric_scale),
      nullable: String(row.is_nullable).toUpperCase() === "YES",
      defaultValue: row.column_default === null ? undefined : String(row.column_default),
      isPrimaryKey: primaryKeyColumns.has(String(row.column_name)),
      comment: row.column_comment === null || row.column_comment === undefined ? undefined : String(row.column_comment),
      position: Number(row.ordinal_position),
    }));
  }

  public async listIndexes(schema: string, table: string): Promise<TDatabaseIndex[]> {
    const client = await this.getClient();
    const result = await client.query(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2",
      [schema, table],
    );

    return (result.rows as TPgRow[]).map((row) => {
      const name = String(row.indexname);
      const definition = String(row.indexdef);
      const columnMatch = definition.match(/\(([^)]+)\)/);
      const columns = columnMatch ? columnMatch[1].split(",").map((column) => column.trim().replace(/"/g, "")) : [];
      return {
        name,
        columns,
        isUnique: /\bUNIQUE\b/i.test(definition),
        isPrimaryKey: name.endsWith("_pkey"),
      };
    });
  }

  public async getPrimaryKey(schema: string, table: string): Promise<{ columns: string[]; constraintName?: string }> {
    const client = await this.getClient();
    const result = await client.query(
      `SELECT tc.constraint_name, kcu.column_name, kcu.ordinal_position
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2
       ORDER BY kcu.ordinal_position`,
      [schema, table],
    );
    const rows = result.rows as TPgRow[];
    return {
      columns: rows.map((row) => String(row.column_name)),
      constraintName: rows[0] ? String(rows[0].constraint_name) : undefined,
    };
  }

  public async countRows(schema: string, table: string): Promise<number> {
    const client = await this.getClient();
    const result = await client.query(`SELECT COUNT(*) AS count FROM ${buildQualifiedName(this.type, schema, table)}`);
    return Number((result.rows[0] as TPgRow | undefined)?.count ?? 0);
  }

  public async getTableData(options: TTableDataOptions): Promise<TDatabaseQueryResult> {
    const qualifiedName = buildQualifiedName(this.type, options.schema, options.table);
    const whereClause = options.where?.trim() ? ` WHERE ${options.where.trim()}` : "";
    const orderClause = options.orderBy?.trim()
      ? ` ORDER BY ${quoteIdentifier(this.type, options.orderBy.trim())} ${options.orderDirection === "desc" ? "DESC" : "ASC"}`
      : "";
    const sql = `SELECT * FROM ${qualifiedName}${whereClause}${orderClause} LIMIT ${options.limit} OFFSET ${options.offset}`;
    return this.runQuery(sql, { maxRows: options.limit });
  }

  public quoteIdentifier(identifier: string): string {
    return quoteIdentifier(this.type, identifier);
  }

  public buildQualifiedName(schema: string, name: string): string {
    return buildQualifiedName(this.type, schema, name);
  }
}
