import readline from "node:readline";
import path from "node:path";
import fs from "fs-extra";
import chalk from "chalk";
import prompts from "prompts";
import { Command } from "commander";
import { searchableSelectChoice } from "../core/prompts";
import { startStudioServer } from "../core/db/db-studio-server";
import {
  duplicateConnection,
  getResolvedConnection,
  listPublicConnections,
  removeConnection,
  renameConnection,
  upsertConnectionFromDraft,
} from "../core/db/db-cache";
import type { TConnectionDraft } from "../core/db/db-cache";
import { createAdapter, testConnectionProfile } from "../core/db/db-connection";
import {
  buildDraftFromCandidate,
  detectAppDatabaseServices,
  ensureCloudFoundrySession,
  getCloudFoundryTargetSummary,
  listCloudFoundryAppsWithCache,
} from "../core/db/db-btp";
import { describeServiceCandidate } from "../core/db/db-vcap-parser";
import { ensureExternalTool } from "../core/tooling";
import { analyzeSqlSafety, appendSafeLimit } from "../core/db/db-metadata";
import { saveQuery } from "../core/db/db-query-files";
import { appendQueryHistory } from "../core/db/db-query-history";
import type { IDatabaseAdapter, TDatabaseQueryResult, TDatabaseType, TResolvedDatabaseConnection } from "../core/db/db-types";

type TStudioCommandOptions = { port?: string; readOnly?: boolean; timeout?: string; debugCf?: boolean; devUi?: boolean; apiOnly?: boolean };
type TImportCommandOptions = { app?: string; service?: string };

function validateRequired(value: string): true | string {
  return value.trim() ? true : "Value is required";
}

function resolvedFromDraft(draft: TConnectionDraft): TResolvedDatabaseConnection {
  const now = new Date().toISOString();
  return {
    id: "candidate",
    name: draft.name,
    type: draft.type,
    region: draft.region,
    org: draft.org,
    space: draft.space,
    app: draft.app,
    serviceName: draft.serviceName,
    servicePlan: draft.servicePlan,
    host: draft.host,
    port: draft.port,
    database: draft.database,
    schema: draft.schema,
    username: draft.username,
    password: draft.password,
    ssl: draft.ssl,
    sslValidateCertificate: draft.sslValidateCertificate,
    createdAt: now,
    updatedAt: now,
  };
}

async function chooseConnectionId(message: string): Promise<string> {
  const connections = await listPublicConnections();

  if (connections.length === 0) {
    throw new Error("No DB connections cached. Run: smdg cf db import");
  }

  return searchableSelectChoice({
    message,
    choices: connections.map((connection) => ({
      title: `${connection.name} · ${connection.type} · ${connection.host}`,
      value: connection.id,
    })),
    allowCustomValue: false,
  });
}

function formatCell(value: unknown, maxWidth: number): string {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

  if (maxWidth > 0 && text.length > maxWidth) {
    return `${text.slice(0, maxWidth - 1)}…`;
  }

  return text;
}

function renderResultTable(result: TDatabaseQueryResult, options?: { showFull?: boolean }): void {
  if (result.rows.length === 0) {
    console.log(chalk.gray(result.affectedRows != null ? `Affected rows: ${result.affectedRows}` : "No rows."));
    return;
  }

  const fields = result.fields.length > 0 ? result.fields : Object.keys(result.rows[0]);
  const maxWidth = options?.showFull ? 0 : 48;
  const widths = fields.map((field) => field.length);

  const renderedRows = result.rows.map((row) =>
    fields.map((field, index) => {
      const cell = formatCell(row[field], maxWidth);
      widths[index] = Math.max(widths[index], cell.length);
      return cell;
    }),
  );

  const header = fields.map((field, index) => chalk.cyan(field.padEnd(widths[index]))).join("  ");
  const separator = fields.map((_, index) => "-".repeat(widths[index])).join("  ");
  console.log(header);
  console.log(chalk.gray(separator));

  for (const row of renderedRows) {
    console.log(row.map((cell, index) => cell.padEnd(widths[index])).join("  "));
  }

  console.log(chalk.gray(`\n${result.rowCount} row(s) · ${result.durationMs}ms${result.truncated ? " · truncated" : ""}`));
}

async function exportRowsInteractively(result: TDatabaseQueryResult): Promise<void> {
  if (result.rows.length === 0) {
    return;
  }

  const choice = await searchableSelectChoice({
    message: "Export result?",
    choices: [
      { title: "No export", value: "none" },
      { title: "CSV file", value: "csv" },
      { title: "JSON file", value: "json" },
    ],
    allowCustomValue: false,
  });

  if (choice === "none") {
    return;
  }

  const fields = result.fields.length > 0 ? result.fields : Object.keys(result.rows[0]);
  const defaultName = choice === "csv" ? "query-result.csv" : "query-result.json";
  const response = await prompts({ type: "text", name: "file", message: "Output file", initial: defaultName });
  const outputFile = String(response.file || defaultName).trim();
  const outputPath = path.resolve(process.cwd(), outputFile);

  if (choice === "json") {
    await fs.writeFile(outputPath, JSON.stringify(result.rows, null, 2), "utf8");
  } else {
    const escapeCell = (value: unknown): string => {
      const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return `"${text.replace(/"/g, '""')}"`;
    };
    const csv = [
      fields.map(escapeCell).join(","),
      ...result.rows.map((row) => fields.map((field) => escapeCell(row[field])).join(",")),
    ].join("\n");
    await fs.writeFile(outputPath, csv, "utf8");
  }

  console.log(chalk.green(`Exported ${result.rows.length} row(s) to ${outputPath}`));
}

async function runStudioCommand(options: TStudioCommandOptions): Promise<void> {
  const apiOnly = Boolean(options.apiOnly || options.devUi);

  const handle = await startStudioServer({
    port: options.port ? Number(options.port) : undefined,
    readOnly: Boolean(options.readOnly),
    queryTimeoutMs: options.timeout ? Number(options.timeout) : undefined,
    debugCf: Boolean(options.debugCf),
    apiOnly,
  });

  const shutdown = async (): Promise<void> => {
    console.log("");
    console.log(chalk.gray("Stopping DB Studio..."));
    // Belt-and-suspenders: handle.close() should now resolve promptly (see
    // db-studio-server.ts), but this guarantees Ctrl+C always exits even if
    // some future cleanup step hangs.
    await Promise.race([handle.close(), new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

async function runImportCommand(options: TImportCommandOptions): Promise<void> {
  await ensureExternalTool("cf");
  let session = await ensureCloudFoundrySession();

  if (!session.loggedIn) {
    // Dynamic import: cf.command.ts registers this module's commands, so a
    // static import here would create a circular require between the two files.
    const { promptAndLoginCloudFoundryInteractively, ensureCfOrgAndSpaceTargetedInteractively } = await import("./cf.command");
    const loggedIn = await promptAndLoginCloudFoundryInteractively({ reason: session.message ?? "Cloud Foundry login is required." });

    if (!loggedIn) {
      throw new Error("Run: smdg cf login");
    }

    await ensureCfOrgAndSpaceTargetedInteractively();
    session = await ensureCloudFoundrySession();

    if (!session.loggedIn) {
      throw new Error(session.message ?? "Cloud Foundry login is required.");
    }
  }

  const target = await getCloudFoundryTargetSummary();
  console.log(chalk.gray(`Target: ${target.region ?? "?"} · ${target.org ?? "?"} / ${target.space ?? "?"}`));

  const appName = options.app?.trim() || await (async () => {
    const apps = await listCloudFoundryAppsWithCache({});
    if (apps.length === 0) {
      throw new Error("No apps found in current CF target.");
    }
    return searchableSelectChoice({
      message: "Select BTP app",
      choices: apps.map((app) => ({ title: `${app.name}${app.requestedState ? ` · ${app.requestedState}` : ""}`, value: app.name })),
      validateCustomValue: validateRequired,
      customValueTitle: (value) => `Use typed app name: ${value}`,
    });
  })();

  console.log(chalk.gray(`Reading cf env ${appName}...`));
  const candidates = await detectAppDatabaseServices(appName);

  const selectedIndex = options.service
    ? String(candidates.findIndex((candidate) => candidate.serviceName === options.service))
    : await searchableSelectChoice({
        message: "Select database service to import",
        choices: candidates.map((candidate, index) => ({ title: describeServiceCandidate(candidate), value: String(index) })),
        allowCustomValue: false,
      });

  const candidate = candidates[Number(selectedIndex)];

  if (!candidate) {
    throw new Error("No database service selected.");
  }

  const draft = buildDraftFromCandidate(candidate, {
    region: target.region,
    org: target.org,
    space: target.space,
    app: appName,
  });

  console.log(chalk.gray("Testing connection..."));
  const testResult = await testConnectionProfile(resolvedFromDraft(draft));

  if (testResult.success) {
    console.log(chalk.green(`Connection OK (${testResult.serverVersion ?? ""}) in ${testResult.durationMs}ms`));
  } else {
    console.log(chalk.yellow(`Connection test failed: ${testResult.message}`));
    const proceed = await prompts({
      type: "confirm",
      name: "save",
      message: "Save the connection anyway?",
      initial: true,
    });

    if (!proceed.save) {
      console.log(chalk.gray("Import cancelled."));
      return;
    }
  }

  const profile = await upsertConnectionFromDraft(draft);
  console.log(chalk.green(`Saved connection: ${profile.name}`));
  console.log(chalk.gray(`Type: ${profile.type} · Host: ${profile.host} · Schema/DB: ${profile.schema ?? profile.database ?? "-"}`));
  console.log(chalk.gray("Password is encrypted in ~/.simplemdg/db-connections.json"));
}

async function runConnectionsCommand(): Promise<void> {
  for (;;) {
    const connections = await listPublicConnections();

    if (connections.length === 0) {
      console.log(chalk.yellow("No DB connections cached. Run: smdg cf db import"));
      return;
    }

    const action = await searchableSelectChoice({
      message: "DB connections",
      choices: [
        { title: "List connections", value: "list" },
        { title: "Test connection", value: "test" },
        { title: "Show connection info (no password)", value: "info" },
        { title: "Rename connection", value: "rename" },
        { title: "Duplicate connection", value: "duplicate" },
        { title: "Remove connection", value: "remove" },
        { title: "Exit", value: "exit" },
      ],
      allowCustomValue: false,
    });

    if (action === "exit") {
      return;
    }

    if (action === "list") {
      for (const connection of connections) {
        console.log(`${chalk.bold(connection.name)} · ${connection.type} · ${connection.host}:${connection.port} · ${connection.org ?? "-"}/${connection.space ?? "-"} · app=${connection.app ?? "-"}`);
      }
      console.log("");
      continue;
    }

    const id = await chooseConnectionId("Select connection");

    if (action === "test") {
      const resolved = await getResolvedConnection(id);
      const result = await testConnectionProfile(resolved);
      console.log(result.success
        ? chalk.green(`OK (${result.serverVersion ?? ""}) in ${result.durationMs}ms`)
        : chalk.red(`Failed: ${result.message}`));
    } else if (action === "info") {
      const connection = connections.find((item) => item.id === id);
      if (connection) {
        console.log(JSON.stringify(connection, null, 2));
      }
    } else if (action === "rename") {
      const response = await prompts({ type: "text", name: "name", message: "New name", validate: validateRequired });
      if (response.name) {
        await renameConnection(id, String(response.name).trim());
        console.log(chalk.green("Renamed."));
      }
    } else if (action === "duplicate") {
      const copy = await duplicateConnection(id);
      console.log(chalk.green(`Duplicated as: ${copy.name}`));
    } else if (action === "remove") {
      const confirm = await prompts({ type: "confirm", name: "ok", message: "Remove this connection?", initial: false });
      if (confirm.ok) {
        await removeConnection(id);
        console.log(chalk.green("Removed."));
      }
    }

    console.log("");
  }
}

async function runQueryCommand(): Promise<void> {
  const connectionId = await chooseConnectionId("Select connection for query");
  const resolved = await getResolvedConnection(connectionId);
  const adapter = createAdapter(resolved);

  try {
    await adapter.connect();
    const response = await prompts({ type: "text", name: "sql", message: "SQL", validate: validateRequired });
    const sql = String(response.sql ?? "").trim();

    if (!sql) {
      return;
    }

    const safety = analyzeSqlSafety(sql, { readOnly: false });

    if (safety.isDestructive) {
      const confirm = await prompts({ type: "confirm", name: "ok", message: `${safety.reason ?? "Dangerous statement."} Run anyway?`, initial: false });
      if (!confirm.ok) {
        console.log(chalk.gray("Cancelled."));
        return;
      }
    }

    const effectiveSql = appendSafeLimit(adapter.type, sql, 1000);
    const result = await adapter.runQuery(effectiveSql, { maxRows: 1000 });
    renderResultTable(result);
    await appendQueryHistory({ connectionId, connectionName: resolved.name, connectionType: adapter.type, sql, durationMs: result.durationMs, success: true, rowCount: result.rowCount });
    await exportRowsInteractively(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await appendQueryHistory({ connectionId, connectionName: resolved.name, connectionType: adapter.type, sql: "", durationMs: 0, success: false, error: message }).catch(() => undefined);
    throw error;
  } finally {
    await adapter.disconnect();
  }
}

function printConsoleHelp(): void {
  console.log(chalk.gray([
    "Commands:",
    "  /connect        switch connection",
    "  /schemas        list schemas",
    "  /tables         list tables/views in current schema",
    "  /desc TABLE     describe table columns",
    "  /top TABLE      select top rows",
    "  /count TABLE    count rows",
    "  /save NAME      save last SQL as a query file",
    "  /history        show query history (recent)",
    "  /export csv     export last result to CSV",
    "  /export json    export last result to JSON",
    "  /full           toggle full-value display",
    "  /clear          clear screen",
    "  /help           show this help",
    "  /exit           quit",
    "Type SQL directly to run it.",
  ].join("\n")));
}

async function runConsoleCommand(): Promise<void> {
  let connectionId = await chooseConnectionId("Select connection for console");
  let resolved = await getResolvedConnection(connectionId);
  let adapter: IDatabaseAdapter = createAdapter(resolved);
  await adapter.connect();
  let schema = resolved.schema ?? "";
  let lastResult: TDatabaseQueryResult | undefined;
  let lastSql = "";
  let showFull = false;

  console.log(chalk.green(`Connected: ${resolved.name} (${resolved.type})`));
  printConsoleHelp();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "sql> " });

  const runAndRender = async (sql: string): Promise<void> => {
    const safety = analyzeSqlSafety(sql, { readOnly: false });
    if (safety.isDestructive) {
      const confirmed = await new Promise<boolean>((resolve) => {
        rl.question(chalk.yellow(`${safety.reason ?? "Dangerous statement."} Run anyway? (y/N) `), (answer) => resolve(/^y(es)?$/i.test(answer.trim())));
      });
      if (!confirmed) {
        console.log(chalk.gray("Cancelled."));
        return;
      }
    }

    try {
      const result = await adapter.runQuery(appendSafeLimit(adapter.type, sql, 1000), { maxRows: 1000 });
      lastResult = result;
      lastSql = sql;
      renderResultTable(result, { showFull });
      await appendQueryHistory({ connectionId, connectionName: resolved.name, connectionType: adapter.type, sql, durationMs: result.durationMs, success: true, rowCount: result.rowCount }).catch(() => undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(message));
      await appendQueryHistory({ connectionId, connectionName: resolved.name, connectionType: adapter.type, sql, durationMs: 0, success: false, error: message }).catch(() => undefined);
    }
  };

  const handleCommand = async (line: string): Promise<boolean> => {
    const [command, ...rest] = line.trim().split(/\s+/);
    const argument = rest.join(" ");

    switch (command) {
      case "/exit":
      case "/quit":
        return true;
      case "/help":
        printConsoleHelp();
        return false;
      case "/clear":
        console.clear();
        return false;
      case "/full":
        showFull = !showFull;
        console.log(chalk.gray(`Full-value display: ${showFull ? "ON" : "OFF"}`));
        return false;
      case "/schemas": {
        const schemas = await adapter.listSchemas();
        console.log(schemas.map((item) => `${item.name}${item.isSystem ? chalk.gray(" (system)") : ""}`).join("\n"));
        return false;
      }
      case "/tables": {
        const objects = await adapter.listObjects({ schema, kinds: ["table", "view"] });
        console.log(objects.map((object) => `${object.kind === "view" ? "[V]" : "[T]"} ${object.name}`).join("\n") || chalk.gray("No tables/views."));
        return false;
      }
      case "/desc": {
        if (!argument) { console.log(chalk.gray("Usage: /desc TABLE")); return false; }
        const columns = await adapter.listColumns(schema, argument);
        renderResultTable({ fields: ["name", "dataType", "nullable", "isPrimaryKey"], rows: columns.map((column) => ({ name: column.name, dataType: column.dataType, nullable: column.nullable, isPrimaryKey: Boolean(column.isPrimaryKey) })), rowCount: columns.length, durationMs: 0 }, { showFull });
        return false;
      }
      case "/top": {
        if (!argument) { console.log(chalk.gray("Usage: /top TABLE")); return false; }
        await runAndRender(`SELECT * FROM ${adapter.buildQualifiedName(schema, argument)} LIMIT 100`);
        return false;
      }
      case "/count": {
        if (!argument) { console.log(chalk.gray("Usage: /count TABLE")); return false; }
        const count = await adapter.countRows(schema, argument);
        console.log(`${count}`);
        return false;
      }
      case "/save": {
        if (!lastSql) { console.log(chalk.gray("No SQL to save yet.")); return false; }
        const name = argument || `console-${new Date().toISOString().slice(0, 19)}`;
        const saved = await saveQuery({ name, sql: lastSql, connectionId, connectionType: adapter.type });
        console.log(chalk.green(`Saved query: ${saved.name}`));
        return false;
      }
      case "/history": {
        const { listQueryHistory } = await import("../core/db/db-query-history");
        const items = await listQueryHistory(20);
        console.log(items.map((item) => `${item.timestamp.slice(0, 19)} · ${item.success ? "ok" : "fail"} · ${item.sql.replace(/\s+/g, " ").slice(0, 80)}`).join("\n") || chalk.gray("No history."));
        return false;
      }
      case "/export": {
        if (!lastResult) { console.log(chalk.gray("No result to export.")); return false; }
        await exportRowsInteractively(lastResult);
        return false;
      }
      case "/connect": {
        connectionId = await chooseConnectionId("Select connection");
        await adapter.disconnect();
        resolved = await getResolvedConnection(connectionId);
        adapter = createAdapter(resolved);
        await adapter.connect();
        schema = resolved.schema ?? "";
        console.log(chalk.green(`Connected: ${resolved.name} (${resolved.type})`));
        return false;
      }
      default:
        console.log(chalk.gray(`Unknown command: ${command}. Type /help`));
        return false;
    }
  };

  await new Promise<void>((resolve) => {
    rl.prompt();
    rl.on("line", (line) => {
      const trimmed = line.trim();
      const work = async (): Promise<void> => {
        if (!trimmed) {
          return;
        }
        if (trimmed.startsWith("/")) {
          const shouldExit = await handleCommand(trimmed);
          if (shouldExit) {
            rl.close();
            return;
          }
        } else {
          await runAndRender(trimmed);
        }
      };

      work().catch((error: unknown) => console.log(chalk.red(error instanceof Error ? error.message : String(error)))).finally(() => rl.prompt());
    });
    rl.on("close", () => resolve());
  });

  await adapter.disconnect();
  console.log(chalk.gray("Console closed."));
}

async function runAddConnectionCommand(): Promise<void> {
  const type = (await searchableSelectChoice({
    message: "Database type",
    choices: [
      { title: "PostgreSQL", value: "postgresql" },
      { title: "SAP HANA", value: "hana" },
    ],
    allowCustomValue: false,
  })) as TDatabaseType;

  const answers = await prompts([
    { type: "text", name: "name", message: "Connection name", validate: validateRequired },
    { type: "text", name: "host", message: "Host", validate: validateRequired },
    { type: "text", name: "port", message: "Port", initial: type === "hana" ? "443" : "5432", validate: (value: string) => /^\d+$/.test(value.trim()) ? true : "Port must be a number" },
    { type: "text", name: "database", message: "Database (optional)" },
    { type: "text", name: "schema", message: "Schema (optional)", initial: type === "postgresql" ? "public" : "" },
    { type: "text", name: "username", message: "Username", validate: validateRequired },
    { type: "password", name: "password", message: "Password", validate: validateRequired },
    { type: "confirm", name: "ssl", message: "Use SSL?", initial: true },
  ]);

  if (!answers.name || !answers.host || !answers.username || !answers.password) {
    console.log(chalk.gray("Cancelled."));
    return;
  }

  const draft: TConnectionDraft = {
    name: String(answers.name).trim(),
    type,
    host: String(answers.host).trim(),
    port: Number(answers.port) || (type === "hana" ? 443 : 5432),
    database: String(answers.database ?? "").trim() || undefined,
    schema: String(answers.schema ?? "").trim() || undefined,
    username: String(answers.username).trim(),
    password: String(answers.password),
    ssl: Boolean(answers.ssl),
    sslValidateCertificate: false,
  };

  console.log(chalk.gray("Testing connection..."));
  const testResult = await testConnectionProfile(resolvedFromDraft(draft));

  if (testResult.success) {
    console.log(chalk.green(`Connection OK (${testResult.serverVersion ?? ""}) in ${testResult.durationMs}ms`));
  } else {
    console.log(chalk.yellow(`Connection test failed: ${testResult.message}`));
    const proceed = await prompts({ type: "confirm", name: "save", message: "Save the connection anyway?", initial: true });
    if (!proceed.save) {
      console.log(chalk.gray("Cancelled."));
      return;
    }
  }

  const profile = await upsertConnectionFromDraft(draft);
  console.log(chalk.green(`Saved connection: ${profile.name}`));
  console.log(chalk.gray("Password is encrypted in ~/.simplemdg/db-connections.json"));
}

export function registerCloudFoundryDbCommands(cfCommand: Command): void {
  const db = cfCommand
    .command("db")
    .description("BTP database explorer: import connections, browse schemas, run SQL, and open DB Studio");

  db
    .command("studio")
    .description("Open the local SimpleMDG CF DB Studio (browser UI for HANA/PostgreSQL)")
    .option("--port <port>", "Preferred local port (auto-falls back if busy)", "45888")
    .option("--read-only", "Start in read-only mode (blocks write/DDL statements)")
    .option("--timeout <ms>", "Query timeout in milliseconds", "30000")
    .option("--debug-cf", "Print verbose Cloud Foundry execution logs (off by default)")
    .option("--dev-ui", "Frontend development mode: API-only server + instructions to run the Vite dev server separately")
    .option("--api-only", "Start only the JSON/SSE API — no UI is served, no browser opens")
    .action(runStudioCommand);

  db
    .command("add")
    .alias("new")
    .description("Add a database connection manually (host/port/user/password) — like a DBeaver connection")
    .action(runAddConnectionCommand);

  db
    .command("import")
    .description("Import a HANA/PostgreSQL connection from a BTP app's cf env (VCAP_SERVICES)")
    .option("--app <appName>", "BTP app name")
    .option("--service <serviceName>", "Service instance name to import")
    .action(runImportCommand);

  db
    .command("connections")
    .alias("conn")
    .description("Manage cached DB connections (list, test, rename, duplicate, remove)")
    .action(runConnectionsCommand);

  db
    .command("query")
    .description("Run a single SQL query against a cached connection and print the result")
    .action(runQueryCommand);

  db
    .command("console")
    .alias("repl")
    .description("Open an interactive terminal SQL console with slash commands")
    .action(runConsoleCommand);
}
