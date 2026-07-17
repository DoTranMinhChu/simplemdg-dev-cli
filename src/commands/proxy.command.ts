import { readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import prompts from "prompts";
import { startProxyStudioServer } from "../core/proxy/studio/proxy-studio-server";
import {
  addOrUpdateProxyUser,
  exportProxyConfig,
  importProxyConfig,
  loadResolvedProxyEnvironments,
  resolveProxyConfigPath,
  resolveProxyUserCredential,
  upsertProxyEnvironment,
} from "../core/proxy/proxy-config-store";
import { setStudioSessionConfigDir } from "../core/proxy/proxy-config-location";
import {
  getRunningProxyPorts,
  isProxyEnvironmentRunning,
  startProxyEnvironment,
  stopProxyEnvironment,
} from "../core/proxy/proxy-runtime";
import { captureSessionFromLiveBrowser, openLoggedInBrowserWindow } from "../core/proxy/proxy-auth-browser";
import {
  generateQuickProxyId,
  parseFetchSnippet,
  sessionFromParsedFetch,
  startQuickProxy,
  stopQuickProxy,
  webOriginFromSession,
} from "../core/proxy/proxy-quick";
import { isPortAvailable } from "../core/studio-shared/studio-server-kit";
import { killProcessUsingPort } from "../core/proxy/proxy-port-registry";
import type { TProxyCaptureCallbacks } from "../core/proxy/proxy-capture";
import type { TCapturedSession, TProxyConfigFile, TProxyStatusEventStage, TResolvedProxyEnvironment } from "../core/proxy/proxy-types";

type TProxyStudioCommandOptions = { port?: string; devUi?: boolean; apiOnly?: boolean; configDir?: string };
type TProxyStartCommandOptions = { user?: string; ports?: string; configDir?: string };
type TProxyLoginCommandOptions = { user?: string; configDir?: string };
type TProxyStopCommandOptions = { port?: string; configDir?: string };
type TProxyStatusCommandOptions = { configDir?: string };
type TProxyListCommandOptions = { configDir?: string };
type TProxyAddCommandOptions = { configDir?: string };
type TProxyQuickCommandOptions = { auto?: string; paste?: boolean; file?: string; port?: string };
type TProxyExportCommandOptions = { redactPasswords?: boolean; configDir?: string };
type TProxyImportCommandOptions = { overwrite?: boolean; configDir?: string };

function cliCallbacks(): TProxyCaptureCallbacks {
  return {
    onLog: (message: string) => console.log(chalk.gray(`  ${message}`)),
    onStage: (_stage: TProxyStatusEventStage, message: string) => console.log(chalk.cyan(message)),
  };
}

function normalizeForMatch(value: string): string {
  return value.toLowerCase().replace(/[\s-]+/g, "");
}

function findEnvironmentMatches(environments: TResolvedProxyEnvironment[], query: string): TResolvedProxyEnvironment[] {
  const normalizedQuery = normalizeForMatch(query);
  return environments.filter(
    (env) => normalizeForMatch(env.id) === normalizedQuery || normalizeForMatch(env.displayName).includes(normalizedQuery),
  );
}

function printAvailableEnvironments(environments: TResolvedProxyEnvironment[]): void {
  if (environments.length === 0) {
    console.log(chalk.gray('No environments configured yet. Run "smdg proxy add" to create one.'));
    return;
  }
  console.log(chalk.gray("Available environments:"));
  for (const env of environments) {
    console.log(`  - ${env.displayName} (${env.id})`);
  }
}

function keepAliveUntilSignalled(onShutdown: () => Promise<void>): Promise<void> {
  const shutdown = async (): Promise<void> => {
    console.log("");
    await onShutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  return new Promise(() => undefined);
}

async function runProxyStudioCommand(options: TProxyStudioCommandOptions): Promise<void> {
  if (options.configDir) {
    setStudioSessionConfigDir(options.configDir);
  }

  const apiOnly = Boolean(options.apiOnly || options.devUi);
  const handle = await startProxyStudioServer({ port: options.port ? Number(options.port) : undefined, apiOnly });

  if (options.devUi) {
    console.log(chalk.gray("Running in --dev-ui mode. In another terminal:"));
    console.log(chalk.cyan("  cd studio && npm run dev"));
    console.log(chalk.gray(`Then open the Vite dev URL; it proxies /api/proxy to ${handle.url}.`));
  }

  await keepAliveUntilSignalled(async () => {
    console.log(chalk.gray("Stopping Proxy Studio..."));
    await Promise.race([handle.close(), new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
  });
}

async function runProxyStartCommand(envQuery: string | undefined, options: TProxyStartCommandOptions): Promise<void> {
  const configPath = resolveProxyConfigPath(options.configDir);
  const environments = loadResolvedProxyEnvironments(configPath);

  if (!envQuery) {
    console.error(chalk.red("Usage: smdg proxy start <env-name>"));
    printAvailableEnvironments(environments);
    process.exitCode = 1;
    return;
  }

  const matches = findEnvironmentMatches(environments, envQuery);

  if (matches.length === 0) {
    console.error(chalk.red(`No environment matches "${envQuery}".`));
    printAvailableEnvironments(environments);
    process.exitCode = 1;
    return;
  }

  if (matches.length > 1) {
    console.error(chalk.red(`Multiple environments match "${envQuery}":`));
    matches.forEach((env) => console.log(`  - ${env.displayName} (${env.id})`));
    process.exitCode = 1;
    return;
  }

  const env = matches[0];
  const ports = options.ports
    ? options.ports.split(",").map((part) => Number(part.trim())).filter((port) => Number.isInteger(port) && port > 0)
    : undefined;

  try {
    const user = resolveProxyUserCredential(env, options.user);
    console.log(chalk.gray(`Starting proxy for ${env.displayName} as ${user.userID}...`));
    const result = await startProxyEnvironment(env, user, { ports, callbacks: cliCallbacks() });
    console.log(chalk.green(`Proxy ready: ${env.displayName} as ${user.userID}`));
    result.ports.forEach((port) => console.log(chalk.green(`  http://127.0.0.1:${port} -> ${env.url}`)));
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.gray("Press Ctrl+C to stop (this also stops session refresh for this environment)."));
  await keepAliveUntilSignalled(async () => {
    console.log(chalk.gray(`Stopping proxy for ${env.displayName}...`));
    await stopProxyEnvironment(env.id);
  });
}

async function runProxyLoginCommand(envQuery: string | undefined, options: TProxyLoginCommandOptions): Promise<void> {
  const configPath = resolveProxyConfigPath(options.configDir);
  const environments = loadResolvedProxyEnvironments(configPath);

  if (!envQuery) {
    console.error(chalk.red("Usage: smdg proxy login <env-name>"));
    printAvailableEnvironments(environments);
    process.exitCode = 1;
    return;
  }

  const matches = findEnvironmentMatches(environments, envQuery);

  if (matches.length === 0) {
    console.error(chalk.red(`No environment matches "${envQuery}".`));
    printAvailableEnvironments(environments);
    process.exitCode = 1;
    return;
  }

  if (matches.length > 1) {
    console.error(chalk.red(`Multiple environments match "${envQuery}":`));
    matches.forEach((env) => console.log(`  - ${env.displayName} (${env.id})`));
    process.exitCode = 1;
    return;
  }

  const env = matches[0];

  try {
    const user = resolveProxyUserCredential(env, options.user);
    console.log(chalk.gray(`Opening a browser logged in to ${env.displayName} as ${user.userID}...`));
    await openLoggedInBrowserWindow(env, user, (message) => console.log(chalk.gray(`  ${message}`)));
    console.log(chalk.green(`Logged in as ${user.userID}. The browser window is left open — use it directly.`));
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}

async function runProxyStopCommand(envQuery: string | undefined, options: TProxyStopCommandOptions): Promise<void> {
  const configPath = resolveProxyConfigPath(options.configDir);
  const environments = loadResolvedProxyEnvironments(configPath);

  if (!envQuery) {
    console.error(chalk.red("Usage: smdg proxy stop <env-name> (or --port <port>)"));
    printAvailableEnvironments(environments);
    process.exitCode = 1;
    return;
  }

  const matches = findEnvironmentMatches(environments, envQuery);
  if (matches.length !== 1) {
    console.error(chalk.red(matches.length === 0 ? `No environment matches "${envQuery}".` : `Multiple environments match "${envQuery}".`));
    printAvailableEnvironments(environments);
    process.exitCode = 1;
    return;
  }

  const env = matches[0];

  // `smdg proxy start <env>` runs as its own foreground process — a separate `smdg proxy
  // stop` invocation has no in-memory visibility into it, so this is a best-effort
  // recovery path: find whatever OS process is actually listening on the environment's
  // ports and terminate it (same mechanism used for EADDRINUSE auto-recovery).
  if (isProxyEnvironmentRunning(env.id)) {
    await stopProxyEnvironment(env.id);
    console.log(chalk.green(`Stopped proxy for ${env.displayName} (this process).`));
    return;
  }

  const ports = options.port ? [Number(options.port)] : env.ports;
  let stoppedAny = false;
  for (const port of ports) {
    if (await isPortAvailable(port)) continue;
    console.log(chalk.gray(`Port ${port} is bound by another process — stopping it...`));
    killProcessUsingPort(port, (line) => console.log(chalk.gray(`  ${line}`)));
    stoppedAny = true;
  }

  if (stoppedAny) {
    console.log(chalk.green(`Stopped proxy port(s) for ${env.displayName}.`));
  } else {
    console.log(chalk.gray(`${env.displayName} does not appear to be running (checked port(s) ${ports.join(", ")}).`));
  }
}

async function runProxyStatusCommand(options: TProxyStatusCommandOptions): Promise<void> {
  const configPath = resolveProxyConfigPath(options.configDir);
  const environments = loadResolvedProxyEnvironments(configPath);

  console.log(chalk.gray(`Config: ${configPath}`));

  if (environments.length === 0) {
    console.log(chalk.gray('No environments configured yet. Run "smdg proxy add" to create one.'));
    return;
  }

  for (const env of environments) {
    const runningHere = isProxyEnvironmentRunning(env.id);
    const portsToCheck = runningHere ? getRunningProxyPorts(env.id) : env.ports;
    const boundPorts: number[] = [];
    for (const port of portsToCheck) {
      if (!(await isPortAvailable(port))) boundPorts.push(port);
    }

    const statusLabel = boundPorts.length > 0 ? chalk.green("running") : chalk.gray("stopped");
    console.log(`${env.displayName} (${env.id}) — ${statusLabel}${boundPorts.length > 0 ? ` on ${boundPorts.join(", ")}` : ""}`);
  }
}

function runProxyListCommand(options: TProxyListCommandOptions): void {
  const configPath = resolveProxyConfigPath(options.configDir);
  const environments = loadResolvedProxyEnvironments(configPath);
  console.log(chalk.gray(`Config: ${configPath}`));
  if (environments.length === 0) {
    console.log(chalk.gray('No environments configured yet. Run "smdg proxy add" to create one.'));
    return;
  }
  for (const env of environments) {
    const usableIds = new Set(env.userList.map((user) => user.userID));
    const userLabels = env.knownUserIds.map((userID) => (usableIds.has(userID) ? userID : `${userID} (no password)`));
    const userIDs = userLabels.join(", ") || "(no users)";
    console.log(`${env.displayName} (${env.id}) — ports ${env.ports.join(",")} — users: ${userIDs}`);
  }
}

function runProxyExportCommand(file: string, options: TProxyExportCommandOptions): void {
  const configPath = resolveProxyConfigPath(options.configDir);
  const exported = exportProxyConfig(configPath, { redactPasswords: options.redactPasswords });
  writeFileSync(file, `${JSON.stringify(exported, null, 2)}\n`, "utf8");

  console.log(chalk.green(`Exported ${exported.environments.length} environment(s) to ${file}`));
  if (options.redactPasswords) {
    console.log(chalk.gray("Passwords were left out — this file is safe to hand to someone else, but won't restore logins on its own."));
  } else {
    console.log(chalk.gray("This is a full backup, including your saved passwords — restorable on this same machine/user with \"smdg proxy import\"."));
  }
}

function runProxyImportCommand(file: string, options: TProxyImportCommandOptions): void {
  const configPath = resolveProxyConfigPath(options.configDir);

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    console.error(chalk.red(`Could not read/parse ${file}: ${error instanceof Error ? error.message : String(error)}`));
    process.exitCode = 1;
    return;
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { environments?: unknown }).environments)) {
    console.error(chalk.red(`${file} doesn't look like a "smdg proxy export" file (expected an "environments" array).`));
    process.exitCode = 1;
    return;
  }

  if (options.overwrite) {
    console.log(chalk.yellow(`This replaces the ENTIRE config at ${configPath} with the contents of ${file}.`));
  }

  const result = importProxyConfig(configPath, parsed as TProxyConfigFile, { overwrite: options.overwrite });
  console.log(chalk.green(`Imported into ${configPath}`));
  console.log(chalk.gray(`  +${result.addedEnvironments} new environment(s), ${result.updatedEnvironments} updated`));
  console.log(
    chalk.gray(
      `  +${result.addedUsers} new user(s)${result.skippedUsers > 0 ? `, ${result.skippedUsers} existing user(s) left untouched (their local password wasn't overwritten)` : ""}`,
    ),
  );
}

async function runProxyAddCommand(options: TProxyAddCommandOptions): Promise<void> {
  const configPath = resolveProxyConfigPath(options.configDir);

  const answers = await prompts([
    { type: "text", name: "repo", message: "Repo/group label (e.g. CYTIVA, DASHBOARD)" },
    { type: "text", name: "name", message: "Environment label (e.g. Prestage 4, QAS - uat)" },
    { type: "text", name: "url", message: "Environment base URL" },
    { type: "text", name: "userID", message: "Login user (userID or email)" },
    { type: "password", name: "password", message: "Password (never printed or logged)" },
  ]);

  if (!answers.repo || !answers.name || !answers.url || !answers.userID || !answers.password) {
    console.error(chalk.red("Cancelled."));
    process.exitCode = 1;
    return;
  }

  const { envId, created } = upsertProxyEnvironment(configPath, answers.repo, answers.name, answers.url);
  addOrUpdateProxyUser(configPath, envId, answers.userID, answers.password);

  console.log(chalk.green(`${created ? "Created" : "Updated"} environment ${envId} and saved user ${answers.userID}.`));
  console.log(chalk.gray(`Config: ${configPath}`));

  const startNow = await prompts({ type: "confirm", name: "value", message: `Start the proxy for ${envId} now?`, initial: true });
  if (startNow.value) {
    await runProxyStartCommand(envId, { configDir: options.configDir });
  }
}

async function runProxyQuickCommand(options: TProxyQuickCommandOptions): Promise<void> {
  if (!options.auto && !options.paste) {
    console.error(chalk.red("Usage: smdg proxy quick --auto <url>   (or --paste [--file <path>])"));
    process.exitCode = 1;
    return;
  }

  const requestedPort = options.port ? Number(options.port) : undefined;
  const id = generateQuickProxyId();
  const onLog = (message: string): void => console.log(chalk.gray(`  ${message}`));

  try {
    let session: TCapturedSession;
    let fallbackUrl: string;

    if (options.auto) {
      console.log(chalk.gray(`Opening ${options.auto} in a browser window. Log in manually — capture is automatic once an authenticated API call is seen.`));
      session = await captureSessionFromLiveBrowser(options.auto, { onLog });
      fallbackUrl = options.auto;
    } else {
      const snippet = options.file
        ? readFileSync(options.file, "utf8")
        : await readStdin();
      const parsed = parseFetchSnippet(snippet);
      if (!parsed) {
        console.error(chalk.red('Could not find a fetch(url, { headers: {...} }) call in the pasted snippet.'));
        process.exitCode = 1;
        return;
      }
      session = sessionFromParsedFetch(parsed);
      fallbackUrl = parsed.url;
    }

    const webUrl = webOriginFromSession(session, fallbackUrl);
    const info = await startQuickProxy(id, session, webUrl, requestedPort, onLog);
    console.log(chalk.green(`Quick proxy ready: http://127.0.0.1:${info.port} -> ${info.url}`));
    console.log(chalk.yellow("No stored credential — this proxy will NOT auto-refresh. Re-run this command once the session expires."));
  } catch (error) {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.gray("Press Ctrl+C to stop."));
  await keepAliveUntilSignalled(async () => {
    console.log(chalk.gray("Stopping quick proxy..."));
    await stopQuickProxy(id);
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

export function registerProxyCommands(program: Command): void {
  const proxy = program
    .command("proxy")
    .description("Local dev-proxy: log into a SAP/enterprise web backend and forward local requests to it (avoids CORS/re-login)");

  proxy
    .command("studio")
    .description("Open the local SimpleMDG Proxy Studio (browser UI)")
    .option("--port <port>", "Preferred local port (auto-falls back if busy)")
    .option("--dev-ui", "Frontend development mode: API-only server + instructions to run the Vite dev server separately")
    .option("--api-only", "Start only the JSON/SSE API — no UI is served, no browser opens")
    .option("--config-dir <path>", "Use this config directory for this session only")
    .action(runProxyStudioCommand);

  proxy
    .command("start")
    .argument("<env>", "Environment name to match (repo, name, or id — fuzzy, case/space/dash-insensitive)")
    .description("Start the proxy for an environment (foreground; Ctrl+C to stop)")
    .option("--user <userID>", "User to log in as (defaults to the environment's first user)")
    .option("--ports <ports>", "Comma-separated custom ports (defaults to the environment's configured ports, or 3000,3001)")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyStartCommand);

  proxy
    .command("login")
    .argument("<env>", "Environment name to match (repo, name, or id — fuzzy, case/space/dash-insensitive)")
    .description("Open a visible browser window logged in to an environment, for direct use (no proxy/forwarding involved)")
    .option("--user <userID>", "User to log in as (defaults to the environment's first user)")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyLoginCommand);

  proxy
    .command("stop")
    .argument("[env]", "Environment name to match")
    .description("Stop a running proxy (best-effort: frees whatever is bound to its ports)")
    .option("--port <port>", "Stop only this specific port instead of all the environment's configured ports")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyStopCommand);

  proxy
    .command("status")
    .description("Show configured environments and whether their ports currently look bound")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyStatusCommand);

  proxy
    .command("list")
    .description("List your configured environments")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyListCommand);

  proxy
    .command("add")
    .description("Add an environment + user (interactive)")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyAddCommand);

  proxy
    .command("export")
    .argument("<file>", "Where to write the exported JSON")
    .description("Back up all your environments (including saved passwords) to a JSON file")
    .option("--redact-passwords", "Leave passwords out — for handing a sanitized copy to someone else instead of a personal backup")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyExportCommand);

  proxy
    .command("import")
    .argument("<file>", "JSON file to import (from \"smdg proxy export\")")
    .description("Restore/import environments from a JSON file — merges by default (never overwrites an existing user's password)")
    .option("--overwrite", "Replace the whole config instead of merging (careful: discards anything not in the imported file)")
    .option("--config-dir <path>", "Use this config directory instead of the default local one")
    .action(runProxyImportCommand);

  proxy
    .command("quick")
    .description('Credential-free "quick" proxy: auto-capture from a live browser, or paste a DevTools "Copy as fetch" snippet')
    .option("--auto <url>", "Open a visible browser at this URL and auto-capture the session once you log in (no DevTools needed)")
    .option("--paste", "Paste a DevTools \"Copy as fetch\" snippet instead (reads --file, or stdin if omitted)")
    .option("--file <path>", "Read the pasted snippet from this file instead of stdin")
    .option("--port <port>", "Preferred local port (auto-picks a free one if omitted)")
    .action(runProxyQuickCommand);
}
