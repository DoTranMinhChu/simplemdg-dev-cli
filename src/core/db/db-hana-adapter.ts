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

// Minimal typed surface for the untyped @sap/hana-client driver.
interface IHanaConnection {
  connect(options: Record<string, string>, callback: (error: Error | null) => void): void;
  exec(sql: string, params: unknown[], callback: (error: Error | null, rows: unknown) => void): void;
  disconnect(callback?: (error: Error | null) => void): void;
}

interface IHanaModule {
  createConnection(): IHanaConnection;
}

const SYSTEM_SCHEMAS = new Set(["SYS", "SYSTEM", "_SYS_BIC", "_SYS_REPO", "_SYS_STATISTICS"]);
const HANA_ROW_KIND = { TABLE: "table", VIEW: "view" } as const;

type THanaRow = Record<string, unknown>;

export class HanaAdapter implements IDatabaseAdapter {
  public readonly type: TDatabaseType = "hana";

  private connection: IHanaConnection | undefined;

  private readonly queryTimeoutMs: number;

  constructor(
    private readonly resolvedConnection: TResolvedDatabaseConnection,
    options?: { queryTimeoutMs?: number },
  ) {
    this.queryTimeoutMs = options?.queryTimeoutMs ?? 30000;
  }

  public async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    let hanaModule: IHanaModule;

    try {
      const imported = (await import("@sap/hana-client")) as unknown as IHanaModule & { default?: IHanaModule };
      // @sap/hana-client's CJS entry assigns `module.exports` to a dynamically
      // `require()`-d native addon, which cjs-module-lexer can't statically
      // analyze for named exports. Under Node ESM interop that means
      // `createConnection` only ever lands on `.default`, never on the
      // namespace object itself — fall back to it here.
      hanaModule = typeof imported.createConnection === "function" ? imported : (imported.default as IHanaModule);
    } catch {
      throw new Error("SAP HANA driver '@sap/hana-client' is not installed. Run: npm install @sap/hana-client");
    }

    if (!hanaModule || typeof hanaModule.createConnection !== "function") {
      throw new Error("SAP HANA driver '@sap/hana-client' loaded but does not expose createConnection()");
    }

    const connection = hanaModule.createConnection();
    const connectOptions: Record<string, string> = {
      serverNode: `${this.resolvedConnection.host}:${this.resolvedConnection.port}`,
      uid: this.resolvedConnection.username,
      pwd: this.resolvedConnection.password,
      encrypt: this.resolvedConnection.ssl === false ? "false" : "true",
      sslValidateCertificate: this.resolvedConnection.sslValidateCertificate ? "true" : "false",
      communicationTimeout: String(this.queryTimeoutMs),
    };

    if (this.resolvedConnection.schema) {
      connectOptions.currentSchema = this.resolvedConnection.schema;
    }

    await new Promise<void>((resolve, reject) => {
      connection.connect(connectOptions, (error) => (error ? reject(error) : resolve()));
    });

    this.connection = connection;
  }

  public async disconnect(): Promise<void> {
    if (this.connection) {
      const connection = this.connection;
      this.connection = undefined;
      await new Promise<void>((resolve) => connection.disconnect(() => resolve()));
    }
  }

  private async getConnection(): Promise<IHanaConnection> {
    if (!this.connection) {
      await this.connect();
    }

    if (!this.connection) {
      throw new Error("SAP HANA connection is not established");
    }

    return this.connection;
  }

  private async exec(sql: string, params: unknown[] = []): Promise<unknown> {
    const connection = await this.getConnection();
    return new Promise<unknown>((resolve, reject) => {
      connection.exec(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
    });
  }

  /**
   * Execute, and on a transient network error (e.g. "Socket closed by peer")
   * disconnect, reconnect, and retry exactly once. Only used for read-only
   * operations — destructive SQL must never be auto-retried.
   */
  private async execWithReconnect(
    sql: string,
    params: unknown[] = [],
    options?: { retryOnNetworkError?: boolean },
  ): Promise<unknown> {
    try {
      return await this.exec(sql, params);
    } catch (error) {
      const info = this.classifyError(error);
      if (options?.retryOnNetworkError && info.retryable) {
        await this.disconnect().catch(() => undefined);
        await this.connect();
        return this.exec(sql, params);
      }
      throw error;
    }
  }

  /** Read-only row fetch with automatic reconnect-and-retry-once on socket loss. */
  private async execRows(sql: string, params: unknown[] = []): Promise<THanaRow[]> {
    const result = await this.execWithReconnect(sql, params, { retryOnNetworkError: true });
    return Array.isArray(result) ? (result as THanaRow[]) : [];
  }

  public async isConnected(): Promise<boolean> {
    if (!this.connection) {
      return false;
    }
    try {
      await this.exec("SELECT 1 FROM SYS.DUMMY");
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
      const rows = await this.execRows("SELECT VERSION FROM SYS.M_DATABASE");
      const version = String(rows[0]?.VERSION ?? "SAP HANA");
      return { success: true, message: "Connection successful", serverVersion: version, durationMs: Date.now() - startedAt };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private toQueryResult(result: unknown, durationMs: number, maxRows?: number): TDatabaseQueryResult {
    if (typeof result === "number") {
      return { fields: [], rows: [], rowCount: 0, affectedRows: result, command: "DML", durationMs };
    }

    const allRows = Array.isArray(result) ? (result as THanaRow[]) : [];
    const limit = maxRows ?? 0;
    const truncated = limit > 0 && allRows.length > limit;
    const rows = truncated ? allRows.slice(0, limit) : allRows;

    return {
      fields: rows.length > 0 ? Object.keys(rows[0]) : [],
      rows,
      rowCount: rows.length,
      command: "SELECT",
      durationMs,
      truncated,
    };
  }

  public async runQuery(sql: string, options?: { maxRows?: number }): Promise<TDatabaseQueryResult> {
    const startedAt = Date.now();
    const result = await this.exec(sql);
    return this.toQueryResult(result, Date.now() - startedAt, options?.maxRows);
  }

  public async runParameterized(sql: string, params: unknown[], options?: { maxRows?: number }): Promise<TDatabaseQueryResult> {
    const startedAt = Date.now();
    const result = await this.exec(sql, params);
    return this.toQueryResult(result, Date.now() - startedAt, options?.maxRows);
  }

  public placeholder(_index: number): string {
    return "?";
  }

  public async listSchemas(): Promise<TDatabaseSchema[]> {
    const rows = await this.execRows("SELECT SCHEMA_NAME FROM SYS.SCHEMAS ORDER BY SCHEMA_NAME");
    return rows.map((row) => {
      const name = String(row.SCHEMA_NAME);
      return { name, isSystem: SYSTEM_SCHEMAS.has(name) || name.startsWith("_SYS") };
    });
  }

  public async listObjects(options: TListObjectsOptions): Promise<TDatabaseObject[]> {
    const schema = options.schema;

    if (!schema) {
      return [];
    }

    const kinds = options.kinds;
    const objects: TDatabaseObject[] = [];

    if (!kinds || kinds.includes("table")) {
      const tables = await this.execRows("SELECT TABLE_NAME FROM SYS.TABLES WHERE SCHEMA_NAME = ? ORDER BY TABLE_NAME", [schema]);
      objects.push(...tables.map((row) => ({ schema, name: String(row.TABLE_NAME), kind: HANA_ROW_KIND.TABLE })));
    }

    if (!kinds || kinds.includes("view") || kinds.includes("column-view")) {
      const views = await this.execRows("SELECT VIEW_NAME FROM SYS.VIEWS WHERE SCHEMA_NAME = ? ORDER BY VIEW_NAME", [schema]);
      objects.push(...views.map((row) => ({ schema, name: String(row.VIEW_NAME), kind: HANA_ROW_KIND.VIEW })));
    }

    if (!kinds || kinds.includes("procedure")) {
      const procedures = await this.execRows("SELECT PROCEDURE_NAME FROM SYS.PROCEDURES WHERE SCHEMA_NAME = ? ORDER BY PROCEDURE_NAME", [schema]);
      objects.push(...procedures.map((row) => ({ schema, name: String(row.PROCEDURE_NAME), kind: "procedure" as const })));
    }

    if (!kinds || kinds.includes("function")) {
      const functions = await this.execRows("SELECT FUNCTION_NAME FROM SYS.FUNCTIONS WHERE SCHEMA_NAME = ? ORDER BY FUNCTION_NAME", [schema]);
      objects.push(...functions.map((row) => ({ schema, name: String(row.FUNCTION_NAME), kind: "function" as const })));
    }

    if (!kinds || kinds.includes("synonym")) {
      const synonyms = await this.execRows("SELECT SYNONYM_NAME FROM SYS.SYNONYMS WHERE SCHEMA_NAME = ? ORDER BY SYNONYM_NAME", [schema]).catch(() => []);
      objects.push(...synonyms.map((row) => ({ schema, name: String(row.SYNONYM_NAME), kind: "synonym" as const })));
    }

    const search = options.search?.trim().toLowerCase();
    return search ? objects.filter((object) => object.name.toLowerCase().includes(search)) : objects;
  }

  public async listColumns(schema: string, table: string): Promise<TDatabaseColumn[]> {
    const primaryKeyRows = await this.execRows(
      "SELECT COLUMN_NAME FROM SYS.CONSTRAINTS WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? AND IS_PRIMARY_KEY = 'TRUE'",
      [schema, table],
    ).catch(() => []);
    const primaryKeyColumns = new Set(primaryKeyRows.map((row) => String(row.COLUMN_NAME)));

    const tableColumns = await this.execRows(
      `SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, DEFAULT_VALUE, POSITION, COMMENTS
       FROM SYS.TABLE_COLUMNS WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? ORDER BY POSITION`,
      [schema, table],
    );

    const columns = tableColumns.length > 0
      ? tableColumns
      : await this.execRows(
          `SELECT COLUMN_NAME, DATA_TYPE_NAME, LENGTH, SCALE, IS_NULLABLE, DEFAULT_VALUE, POSITION
           FROM SYS.VIEW_COLUMNS WHERE SCHEMA_NAME = ? AND VIEW_NAME = ? ORDER BY POSITION`,
          [schema, table],
        ).catch(() => []);

    return columns.map((row) => ({
      name: String(row.COLUMN_NAME),
      dataType: String(row.DATA_TYPE_NAME),
      length: row.LENGTH === null || row.LENGTH === undefined ? undefined : Number(row.LENGTH),
      scale: row.SCALE === null || row.SCALE === undefined ? undefined : Number(row.SCALE),
      nullable: String(row.IS_NULLABLE).toUpperCase() === "TRUE",
      defaultValue: row.DEFAULT_VALUE === null || row.DEFAULT_VALUE === undefined ? undefined : String(row.DEFAULT_VALUE),
      isPrimaryKey: primaryKeyColumns.has(String(row.COLUMN_NAME)),
      comment: row.COMMENTS === null || row.COMMENTS === undefined ? undefined : String(row.COMMENTS),
      position: Number(row.POSITION),
    }));
  }

  public async listIndexes(schema: string, table: string): Promise<TDatabaseIndex[]> {
    const indexes = await this.execRows(
      "SELECT INDEX_NAME, INDEX_TYPE, CONSTRAINT FROM SYS.INDEXES WHERE SCHEMA_NAME = ? AND TABLE_NAME = ?",
      [schema, table],
    ).catch(() => []);

    const result: TDatabaseIndex[] = [];

    for (const indexRow of indexes) {
      const indexName = String(indexRow.INDEX_NAME);
      const columnRows = await this.execRows(
        "SELECT COLUMN_NAME FROM SYS.INDEX_COLUMNS WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? AND INDEX_NAME = ? ORDER BY POSITION",
        [schema, table, indexName],
      ).catch(() => []);
      const constraint = String(indexRow.CONSTRAINT ?? "");

      result.push({
        name: indexName,
        columns: columnRows.map((row) => String(row.COLUMN_NAME)),
        isUnique: /UNIQUE/i.test(constraint) || /UNIQUE/i.test(String(indexRow.INDEX_TYPE ?? "")),
        isPrimaryKey: /PRIMARY KEY/i.test(constraint),
      });
    }

    return result;
  }

  public async getPrimaryKey(schema: string, table: string): Promise<{ columns: string[]; constraintName?: string }> {
    const rows = await this.execRows(
      `SELECT COLUMN_NAME, CONSTRAINT_NAME, POSITION FROM SYS.CONSTRAINTS
       WHERE SCHEMA_NAME = ? AND TABLE_NAME = ? AND IS_PRIMARY_KEY = 'TRUE' ORDER BY POSITION`,
      [schema, table],
    ).catch(() => []);
    return {
      columns: rows.map((row) => String(row.COLUMN_NAME)),
      constraintName: rows[0] ? String(rows[0].CONSTRAINT_NAME) : undefined,
    };
  }

  public async countRows(schema: string, table: string): Promise<number> {
    const rows = await this.execRows(`SELECT COUNT(*) AS ROW_COUNT FROM ${buildQualifiedName(this.type, schema, table)}`);
    return Number(rows[0]?.ROW_COUNT ?? 0);
  }

  public async getTableData(options: TTableDataOptions): Promise<TDatabaseQueryResult> {
    const qualifiedName = buildQualifiedName(this.type, options.schema, options.table);
    const whereClause = options.where?.trim() ? ` WHERE ${options.where.trim()}` : "";
    const orderClause = options.orderBy?.trim()
      ? ` ORDER BY ${quoteIdentifier(this.type, options.orderBy.trim())} ${options.orderDirection === "desc" ? "DESC" : "ASC"}`
      : "";
    const sql = `SELECT * FROM ${qualifiedName}${whereClause}${orderClause} LIMIT ${options.limit} OFFSET ${options.offset}`;
    // Read-only: safe to reconnect-and-retry once on a dropped socket.
    const startedAt = Date.now();
    const result = await this.execWithReconnect(sql, [], { retryOnNetworkError: true });
    return this.toQueryResult(result, Date.now() - startedAt, options.limit);
  }

  public quoteIdentifier(identifier: string): string {
    return quoteIdentifier(this.type, identifier);
  }

  public buildQualifiedName(schema: string, name: string): string {
    return buildQualifiedName(this.type, schema, name);
  }
}
