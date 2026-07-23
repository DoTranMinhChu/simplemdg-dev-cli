import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import net from "node:net";
import nodeFs from "node:fs";
import fs from "fs-extra";
import chalk from "chalk";
import { Command } from "commander";
import { registerCloudFoundryDbCommands } from "./cf-db.command";
import prompts from "prompts";
import { getDefaultInteractionContext } from "../core/interaction/default-interaction-context";
import type { TInteractionContext } from "../core/interaction/interaction-service";
import {
  authenticateCloudFoundry,
  buildCloudFoundryTargetKey,
  listCloudFoundryApps,
  inferCloudFoundryRegionFromApiEndpoint,
  listCloudFoundryOrganizations,
  listCloudFoundrySpaces,
  readCloudFoundryTarget,
  scanCloudFoundryOrganizationsAcrossRegions,
  setCloudFoundryApiEndpoint,
  targetCloudFoundryOrg,
  targetCloudFoundrySpace,
} from "../core/cf";
import { parseCloudFoundryEnvironment } from "../core/cf-env-parser";
import {
  readCache,
  rememberCloudFoundryApps,
  rememberCloudFoundryLoginProfile,
  rememberCloudFoundryOrgEntries,
  rememberEnvironmentFileName,
  rememberSelectedApp,
} from "../core/cache";
import { runCommand, runCommandInherit } from "../core/process";
import { resolveRepositoryPath } from "../core/repository";
import { searchableSelectChoice, selectFromHistoryOrInput } from "../core/prompts";
import { ensureExternalTool } from "../core/tooling";
import { smartRead, buildCfAppsKey, formatRelativeTime, DEFAULT_CACHE_TTL } from "../core/cache/smart-cache";
import {
  addFavoriteTarget,
  addRecentTarget,
  isFavoriteTarget,
  listFavoriteTargets,
  listRecentTargets,
  removeFavoriteTarget,
} from "../core/cf/cf-target-cache";
import { cfTargetKey, cfTargetLabel } from "../core/cf/cf-target.types";
import type { TCfTarget } from "../core/cf/cf-target.types";
import {
  addCustomRegion,
  getEnabledRegionEndpoints,
  listEnabledRegions,
  listRegions,
  removeRegion,
  setRegionEnabled,
} from "../core/cf/cf-region-registry";
import type { TCfRegionEndpoint } from "../core/cf/cf-region-registry";
import {
  getCrossRegionStatus,
  listCrossRegionTargets,
  scanCrossRegionTargets,
} from "../core/cf/cf-cross-region-scanner";
import { decryptCfPassword, loginCfWithPassword } from "../core/cf/cf-auth-service";
import type { TCloudFoundryApp, TCloudFoundryLoginProfile, TCloudFoundryOrgEntry, TCloudFoundryTarget } from "../core/types";

type TCloudFoundryLoginOptions = {
  api?: string;
  username?: string;
  password?: string;
  org?: string;
  space?: string;
  savePassword?: boolean;
};

type TCloudFoundryAppsOptions = {
  refresh?: boolean;
  select?: boolean;
};

type TCloudFoundryOrgOptions = {
  list?: boolean;
  switch?: boolean;
  refresh?: boolean;
  org?: string;
  space?: string;
  api?: string;
};

type TCloudFoundryBindOptions = {
  app?: string;
  cwd?: string;
  refresh?: boolean;
  target?: boolean;
};

type TCloudFoundryEnvOptions = {
  app?: string;
  out?: string;
  cwd?: string;
  refresh?: boolean;
  raw?: boolean;
  target?: boolean;
};

type TCloudFoundryLogsOptions = {
  app?: string;
  out?: string;
  refresh?: boolean;
  recent?: boolean;
  follow?: boolean;
  instance?: string;
  process?: string;
  target?: boolean;
};

type TCloudFoundrySshOptions = {
  app?: string;
  refresh?: boolean;
  instance?: string;
  target?: boolean;
};

type TCloudFoundryHttpWatchOptions = {
  app?: string;
  refresh?: boolean;
  recent?: boolean;
  out?: string;
  skipOrgSelect?: boolean;
};

type TCloudFoundryDebugOptions = {
  app?: string;
  refresh?: boolean;
  instance?: string;
  process?: string;
  localPort?: string;
  remotePort?: string;
  enableSsh?: boolean;
  restart?: boolean;
  check?: boolean;
  linkOnly?: boolean;
  vscode?: boolean;
  chrome?: boolean;
  configOnly?: boolean;
  open?: boolean;
  skipOrgSelect?: boolean;
};

type TCloudFoundryRequestTraceOptions = {
  app?: string;
  refresh?: boolean;
  instance?: string;
  process?: string;
  localPort?: string;
  remotePort?: string;
  maxBodyBytes?: string;
  skipOrgSelect?: boolean;
  out?: string;
};

type TRequestTraceMode = "path" | "headers" | "body" | "response";

type TRequestTraceAuthMode = "mask" | "full" | "omit";

type TRequestTraceHeaderPreset = "minimal" | "common" | "all" | "custom";

type TRequestTraceDisplayOptions = {
  headerPreset: TRequestTraceHeaderPreset;
  headerNames: string[];
  parseBodyJson: boolean;
  outputFile?: string;
};

type TRequestTraceFilterState = {
  method?: string;
  path?: string;
  body?: string;
  status?: string;
  text?: string;
  paused: boolean;
};

type TRequestTraceRuntimeState = {
  display: TRequestTraceDisplayOptions;
  filters: TRequestTraceFilterState;
  events: Record<string, unknown>[];
};

type TCloudFoundryDebugMode =
  | "vscode"
  | "chrome"
  | "config-only"
  | "link-only"
  | "check-ssh"
  | "enable-ssh";

type TNodeInspectorPrepareMode =
  | "set-env-restart"
  | "running-process"
  | "already-enabled";

function validateRequired(value: string): true | string {
  return value.trim() ? true : "Value is required";
}

/**
 * Interactive first-time-login fallback shared by CLI commands that need a CF
 * session but find no cached credentials. Prompts for (optionally) a region /
 * API endpoint, email, password, and whether to remember the credential, then
 * logs in via the same `loginCfWithPassword` used by Studio (so the password is
 * encrypted before being cached, and the isolated per-region CF_HOME is also
 * authenticated). Returns false if the user declines or the login fails —
 * callers decide whether that's fatal.
 */
export async function promptAndLoginCloudFoundryInteractively(options?: {
  apiEndpoint?: string;
  reason?: string;
}, ctx: TInteractionContext = getDefaultInteractionContext()): Promise<boolean> {
  ctx.interaction.notify({ level: "warn", message: options?.reason || "Cloud Foundry login is required." });

  const proceed = await ctx.interaction.confirm({ message: "Login now?", initial: true });

  if (!proceed) {
    ctx.interaction.notify({ level: "muted", message: "Skipped login. Run smdg cf login when you're ready." });
    return false;
  }

  let apiEndpoint = options?.apiEndpoint;

  if (!apiEndpoint) {
    const regions = await listEnabledRegions();
    const endpointChoice = await ctx.interaction.select({
      message: "CF API endpoint / region",
      choices: [
        ...regions.map((region) => ({ title: `${region.label || region.region} – ${region.apiEndpoint}`, value: region.apiEndpoint })),
        { title: "Custom endpoint…", value: "__custom__" },
      ],
      allowCustomValue: false,
    });

    apiEndpoint = endpointChoice === "__custom__"
      ? (await ctx.interaction.input({ message: "Custom CF API endpoint", validate: validateRequired })).trim()
      : endpointChoice;
  }

  if (!apiEndpoint) {
    ctx.interaction.notify({ level: "muted", message: "No API endpoint provided. Login cancelled." });
    return false;
  }

  const email = await ctx.interaction.input({ message: "Email", validate: validateRequired });
  const password = await ctx.interaction.input({ message: "Password", validate: validateRequired, mask: true });
  const remember = await ctx.interaction.confirm({ message: "Remember credentials securely?", initial: true });

  if (!email || !password) {
    ctx.interaction.notify({ level: "muted", message: "Login cancelled." });
    return false;
  }

  const result = await loginCfWithPassword({
    apiEndpoint,
    username: email.trim(),
    password,
    remember,
  });

  if (!result.success) {
    ctx.interaction.notify({ level: "error", message: result.error || "Login failed." });
    return false;
  }

  ctx.interaction.notify({ level: "success", message: result.message || `Logged in as ${result.username}.` });
  return true;
}

/**
 * After a fresh interactive login, the global CF session is authenticated but
 * has no org/space targeted yet (login alone doesn't pick one). Pick one
 * interactively so the calling command can continue as if the user had already
 * run `cf target` — skips silently if there is exactly one choice or none.
 */
export async function ensureCfOrgAndSpaceTargetedInteractively(ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  const target = await readCloudFoundryTarget();

  if (target.org) {
    return;
  }

  const orgs = await listCloudFoundryOrganizations().catch(() => [] as string[]);

  if (!orgs.length) {
    return;
  }

  const org = orgs.length === 1
    ? orgs[0]
    : await ctx.interaction.select({
        message: "Select CF org",
        choices: orgs.map((item) => ({ title: item, value: item })),
        validateCustomValue: validateRequired,
        customValueTitle: (value) => `Use typed CF org: ${value}`,
      });

  await targetCloudFoundryOrg(org);

  const spaces = await listCloudFoundrySpaces().catch(() => [] as string[]);

  if (!spaces.length) {
    return;
  }

  const space = spaces.length === 1
    ? spaces[0]
    : await ctx.interaction.select({
        message: "Select CF space",
        choices: spaces.map((item) => ({ title: item, value: item })),
        validateCustomValue: validateRequired,
        customValueTitle: (value) => `Use typed CF space: ${value}`,
      });

  await targetCloudFoundrySpace(space);
}

async function ensureCloudFoundrySessionFromCache(ctx: TInteractionContext = getDefaultInteractionContext()): Promise<TCloudFoundryTarget> {
  await ensureExternalTool("cf");
  const target = await readCloudFoundryTarget();

  if (target.apiEndpoint && target.user) {
    return target;
  }

  const cache = await readCache();
  const profilesWithPassword = cache.cloudFoundry.loginProfiles.filter((profile) => profile.password?.trim());

  if (!profilesWithPassword.length) {
    const loggedIn = await promptAndLoginCloudFoundryInteractively({
      reason: "Cloud Foundry login is required.",
    }, ctx);

    if (!loggedIn) {
      throw new Error("Cloud Foundry login is required. Run: smdg cf login");
    }

    await ensureCfOrgAndSpaceTargetedInteractively(ctx);
    return readCloudFoundryTarget();
  }

  const preferredProfiles = target.apiEndpoint
    ? [
        ...profilesWithPassword.filter((profile) => profile.apiEndpoint === target.apiEndpoint),
        ...profilesWithPassword.filter((profile) => profile.apiEndpoint !== target.apiEndpoint),
      ]
    : profilesWithPassword;

  const selectedProfileIndex = preferredProfiles.length === 1
    ? "0"
    : await ctx.interaction.select({
        message: "Select cached CF login profile for automatic re-login",
        choices: preferredProfiles.map((profile, index) => ({
          title: `${profile.username} · ${profile.org}${profile.space ? `/${profile.space}` : ""} · ${inferCloudFoundryRegionFromApiEndpoint(profile.apiEndpoint)}`,
          value: String(index),
        })),
        allowCustomValue: false,
      });

  const profile = preferredProfiles[Number(selectedProfileIndex)] ?? preferredProfiles[0];

  ctx.interaction.notify({ level: "muted", message: `Auto login CF: ${profile.username} · ${inferCloudFoundryRegionFromApiEndpoint(profile.apiEndpoint)} · ${profile.org}${profile.space ? `/${profile.space}` : ""}` });

  const apiExitCode = await setCloudFoundryApiEndpoint(profile.apiEndpoint);

  if (apiExitCode !== 0) {
    process.exitCode = apiExitCode;
    throw new Error("CF api target failed");
  }

  const authExitCode = await authenticateCloudFoundry({
    username: profile.username,
    password: decryptCfPassword(profile.password as string),
  });

  if (authExitCode !== 0) {
    process.exitCode = authExitCode;
    throw new Error("CF automatic login failed. Run smdg cf login and update the cached password.");
  }

  const orgExitCode = await targetCloudFoundryOrg(profile.org);

  if (orgExitCode !== 0) {
    process.exitCode = orgExitCode;
    throw new Error("CF org target failed");
  }

  if (profile.space) {
    const spaceExitCode = await targetCloudFoundrySpace(profile.space);

    if (spaceExitCode !== 0) {
      process.exitCode = spaceExitCode;
      throw new Error("CF space target failed");
    }
  }

  await rememberCloudFoundryLoginProfile({
    ...profile,
    updatedAt: new Date().toISOString(),
  });

  return readCloudFoundryTarget();
}


function sortCloudFoundryProfilesForEndpoint(options: {
  profiles: TCloudFoundryLoginProfile[];
  apiEndpoint: string;
  preferredOrg?: string;
}): TCloudFoundryLoginProfile[] {
  const profilesWithPassword = options.profiles.filter((profile) => profile.password?.trim());

  return [
    ...profilesWithPassword.filter((profile) => profile.apiEndpoint === options.apiEndpoint && profile.org === options.preferredOrg),
    ...profilesWithPassword.filter((profile) => profile.apiEndpoint === options.apiEndpoint && profile.org !== options.preferredOrg),
    ...profilesWithPassword.filter((profile) => profile.apiEndpoint !== options.apiEndpoint && profile.org === options.preferredOrg),
    ...profilesWithPassword.filter((profile) => profile.apiEndpoint !== options.apiEndpoint && profile.org !== options.preferredOrg),
  ].filter((profile, index, array) => {
    return array.findIndex((item) => {
      return item.apiEndpoint === profile.apiEndpoint
        && item.username === profile.username
        && item.password === profile.password
        && item.org === profile.org
        && item.space === profile.space;
    }) === index;
  });
}

async function ensureCloudFoundryAuthenticatedForApiEndpoint(options: {
  apiEndpoint: string;
  preferredOrg?: string;
  preferredSpace?: string;
  reason?: string;
}, ctx: TInteractionContext = getDefaultInteractionContext()): Promise<TCloudFoundryLoginProfile | undefined> {
  const apiExitCode = await setCloudFoundryApiEndpoint(options.apiEndpoint);

  if (apiExitCode !== 0) {
    process.exitCode = apiExitCode;
    throw new Error(`Cannot set CF API endpoint: ${options.apiEndpoint}`);
  }

  const orgsCheck = await runCommand("cf", ["orgs"]);

  if (orgsCheck.exitCode === 0) {
    return undefined;
  }

  const cache = await readCache();
  const profiles = sortCloudFoundryProfilesForEndpoint({
    profiles: cache.cloudFoundry.loginProfiles,
    apiEndpoint: options.apiEndpoint,
    preferredOrg: options.preferredOrg,
  });

  if (!profiles.length) {
    const loggedIn = await promptAndLoginCloudFoundryInteractively({
      apiEndpoint: options.apiEndpoint,
      reason: `Not logged in to ${inferCloudFoundryRegionFromApiEndpoint(options.apiEndpoint)} and no cached password was found for automatic login.`,
    }, ctx);

    if (!loggedIn) {
      throw new Error("Cloud Foundry automatic login is required");
    }

    const refreshedCache = await readCache();
    return refreshedCache.cloudFoundry.loginProfiles.find((item) => item.apiEndpoint === options.apiEndpoint);
  }

  let lastError = orgsCheck.stderr || orgsCheck.stdout || "cf orgs failed";

  for (const profile of profiles) {
    ctx.interaction.notify({ level: "muted", message: `Auto auth CF ${inferCloudFoundryRegionFromApiEndpoint(options.apiEndpoint)} as ${profile.username}...` });
    const authExitCode = await authenticateCloudFoundry({
      username: profile.username,
      password: decryptCfPassword(profile.password as string),
    });

    if (authExitCode !== 0) {
      lastError = `cf auth failed for ${profile.username}`;
      continue;
    }

    const nextOrgsCheck = await runCommand("cf", ["orgs"]);

    if (nextOrgsCheck.exitCode === 0) {
      const updatedProfile: TCloudFoundryLoginProfile = {
        ...profile,
        apiEndpoint: options.apiEndpoint,
        org: options.preferredOrg || profile.org,
        space: options.preferredSpace || profile.space,
        updatedAt: new Date().toISOString(),
      };
      await rememberCloudFoundryLoginProfile(updatedProfile);
      return updatedProfile;
    }

    lastError = nextOrgsCheck.stderr || nextOrgsCheck.stdout || lastError;
  }

  throw new Error(`CF automatic login failed for ${options.apiEndpoint}. ${lastError}`);
}

function buildCloudFoundryLogsArgs(options: { appName: string; recent?: boolean }): string[] {
  const args = ["logs", options.appName];

  if (options.recent) {
    args.push("--recent");
  }

  return args;
}

function parsePositivePort(value: string | undefined, defaultValue: number): number {
  if (!value?.trim()) {
    return defaultValue;
  }

  const port = Number(value.trim());

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return port;
}

function buildNodeInspectorRemoteCommand(remotePort: number): string {
  if (remotePort !== 9229) {
    return [
      `echo "Remote port ${remotePort} was requested."`,
      `echo "SIGUSR1 starts the Node.js inspector on its default port 9229 for a running Node process."`,
      `echo "Use remote port 9229, or start the app process with NODE_OPTIONS=--inspect=0.0.0.0:${remotePort}."`,
      `exit 2`,
    ].join("; ");
  }

  const detectNodePidScript = [
    `PID=""`,
    `if command -v pgrep >/dev/null 2>&1; then PID=$(pgrep -f "(^|/| )node( |$)" 2>/dev/null | head -n 1 || true); fi`,
    `if [ -z "$PID" ]; then PID=$(ps -eo pid=,args= 2>/dev/null | awk '/[n]ode/ && $0 !~ /awk/ && $0 !~ /pgrep/ {print $1; exit}'); fi`,
    `if [ -z "$PID" ]; then echo "No Node.js PID found in app container. Use prepare mode: Set NODE_OPTIONS and restart app." >&2; ps -eo pid,args 2>/dev/null | head -n 40 >&2; exit 1; fi`,
    `echo "Detected Node.js PID: $PID"`,
    `if command -v ss >/dev/null 2>&1 && ss -H -ntl "sport = :9229" | grep -q .; then echo "Node inspector already listening on 127.0.0.1:9229"; tail -f /dev/null; fi`,
    `if command -v netstat >/dev/null 2>&1 && netstat -ntl 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)9229$'; then echo "Node inspector already listening on 127.0.0.1:9229"; tail -f /dev/null; fi`,
    `kill -USR1 "$PID" || { echo "Cannot send SIGUSR1 to Node.js PID $PID. Use prepare mode: Set NODE_OPTIONS and restart app." >&2; exit 1; }`,
    `echo "Requested Node inspector for PID $PID on 127.0.0.1:9229"`,
    `COUNT=0; while [ "$COUNT" -lt 20 ]; do if command -v ss >/dev/null 2>&1 && ss -H -ntl "sport = :9229" | grep -q .; then echo "Node inspector is listening on 127.0.0.1:9229"; break; fi; if command -v netstat >/dev/null 2>&1 && netstat -ntl 2>/dev/null | awk '{print $4}' | grep -Eq '(^|:)9229$'; then echo "Node inspector is listening on 127.0.0.1:9229"; break; fi; COUNT=$((COUNT + 1)); sleep 1; done`,
    `tail -f /dev/null`,
  ];

  return detectNodePidScript.join("; ");
}

function buildKeepAliveRemoteCommand(): string {
  return [
    `echo "SSH tunnel is open. Keep this terminal running."`,
    `tail -f /dev/null`,
  ].join("; ");
}

function buildCloudFoundryDebugSshArgs(options: {
  appName: string;
  instanceIndex: string;
  processName?: string;
  localPort: number;
  remotePort: number;
  prepareMode: TNodeInspectorPrepareMode;
}): string[] {
  const args = [
    "ssh",
    options.appName,
    "-i",
    options.instanceIndex,
  ];

  if (options.processName?.trim()) {
    args.push("--process", options.processName.trim());
  }

  const remoteCommand = options.prepareMode === "running-process"
    ? buildNodeInspectorRemoteCommand(options.remotePort)
    : buildKeepAliveRemoteCommand();

  args.push(
    "-T",
    "-L",
    `${options.localPort}:127.0.0.1:${options.remotePort}`,
    "-c",
    remoteCommand,
  );

  return args;
}

async function selectNodeInspectorPrepareMode(options: { appName: string; remotePort: number }): Promise<TNodeInspectorPrepareMode> {
  return searchableSelectChoice({
    message: "Prepare Node.js inspector",
    choices: [
      {
        title: "Set NODE_OPTIONS and restart app (recommended first time)",
        value: "set-env-restart",
        description: `Runs cf set-env ${options.appName} NODE_OPTIONS --inspect=0.0.0.0:${options.remotePort} and cf restart`,
      },
      {
        title: "Try start inspector on running Node process without restart",
        value: "running-process",
        description: "Uses cf ssh + SIGUSR1. Fast, but may fail if Node PID cannot be detected.",
      },
      {
        title: "Inspector is already enabled, only open SSH tunnel",
        value: "already-enabled",
        description: "Use when NODE_OPTIONS already contains --inspect and app was restarted.",
      },
    ],
    allowCustomValue: false,
  }) as Promise<TNodeInspectorPrepareMode>;
}

async function ensureSshEnabledForDebug(appName: string): Promise<void> {
  const sshEnabledResult = await runCommand("cf", ["ssh-enabled", appName]);
  const combinedOutput = `${sshEnabledResult.stdout}
${sshEnabledResult.stderr}`;

  if (sshEnabledResult.exitCode === 0 && /enabled/i.test(combinedOutput) && !/not enabled/i.test(combinedOutput)) {
    return;
  }

  console.log(chalk.yellow("SSH is not enabled for this app. Enabling SSH..."));
  const enableResult = await runCommand("cf", ["enable-ssh", appName]);

  if (enableResult.stdout) console.log(enableResult.stdout);
  if (enableResult.stderr) console.error(enableResult.stderr);

  if (enableResult.exitCode !== 0) {
    throw new Error("cf enable-ssh failed. You may not have permission to enable SSH for this app.");
  }
}

async function setNodeInspectorEnvironmentAndRestart(options: { appName: string; remotePort: number }): Promise<void> {
  const nodeOptions = `--inspect=0.0.0.0:${options.remotePort} --enable-source-maps`;

  console.log(chalk.gray(`Setting NODE_OPTIONS for ${options.appName}: ${nodeOptions}`));
  const setEnvResult = await runCommand("cf", ["set-env", options.appName, "NODE_OPTIONS", nodeOptions]);

  if (setEnvResult.stdout) console.log(setEnvResult.stdout);
  if (setEnvResult.stderr) console.error(setEnvResult.stderr);

  if (setEnvResult.exitCode !== 0) {
    throw new Error("cf set-env NODE_OPTIONS failed");
  }

  console.log(chalk.yellow("Restarting app so NODE_OPTIONS takes effect..."));
  const restartExitCode = await runCommandInherit("cf", ["restart", options.appName]);

  if (restartExitCode !== 0) {
    throw new Error(`cf restart ${options.appName} failed`);
  }
}

async function getNodeInspectorDebugUrl(localPort: number): Promise<string | undefined> {
  const response = await fetch(`http://127.0.0.1:${localPort}/json/list`);

  if (!response.ok) {
    return undefined;
  }

  const targets = await response.json() as Array<{ webSocketDebuggerUrl?: string }>;
  const webSocketDebuggerUrl = targets.find((target) => target.webSocketDebuggerUrl)?.webSocketDebuggerUrl;

  if (!webSocketDebuggerUrl) {
    return undefined;
  }

  const webSocketAddress = webSocketDebuggerUrl.replace(/^ws:\/\//, "");
  return `devtools://devtools/bundled/inspector.html?ws=${webSocketAddress}`;
}

async function waitForNodeInspectorDebugUrl(localPort: number, timeoutMs = 10000): Promise<string | undefined> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const debugUrl = await getNodeInspectorDebugUrl(localPort);

      if (debugUrl) {
        return debugUrl;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (lastError instanceof Error) {
    console.log(chalk.gray(`Could not read inspector JSON yet: ${lastError.message}`));
  }

  return undefined;
}

function printNodeInspectorAttachInfo(options: { appName: string; instanceIndex: string; localPort: number; debugUrl?: string }): void {
  console.log("");
  console.log(chalk.green(`Debug tunnel is ready for ${options.appName} instance ${options.instanceIndex}.`));
  console.log(`Chrome inspect: ${chalk.cyan("chrome://inspect")}`);
  console.log(`Local inspector JSON: ${chalk.cyan(`http://127.0.0.1:${options.localPort}/json/list`)}`);

  if (options.debugUrl) {
    console.log(`Direct DevTools link: ${chalk.cyan(options.debugUrl)}`);
  } else {
    console.log(chalk.yellow("Direct DevTools link was not detected yet. Open chrome://inspect and configure localhost target."));
  }

  console.log("");
  console.log(chalk.gray("VS Code attach config:"));
  console.log(JSON.stringify({
    type: "node",
    request: "attach",
    name: `Attach ${options.appName} on BTP`,
    address: "127.0.0.1",
    port: options.localPort,
    localRoot: "${workspaceFolder}",
    remoteRoot: "/home/vcap/app",
    skipFiles: ["<node_internals>/**"],
  }, null, 2));
  console.log("");
  console.log(chalk.gray("Keep this terminal open. Press Ctrl+C to close the debug tunnel."));
}


function buildVscodeNodeAttachConfiguration(options: {
  appName: string;
  localPort: number;
  remoteRoot: string;
}): Record<string, unknown> {
  return {
    type: "node",
    request: "attach",
    name: `Attach BTP ${options.appName}`,
    address: "127.0.0.1",
    port: options.localPort,
    localRoot: "${workspaceFolder}",
    remoteRoot: options.remoteRoot,
    protocol: "inspector",
    sourceMaps: true,
    restart: true,
    skipFiles: ["<node_internals>/**"],
    outFiles: [
      "${workspaceFolder}/**/*.js",
      "!**/node_modules/**",
    ],
  };
}

async function writeVscodeLaunchConfiguration(options: {
  cwd: string;
  appName: string;
  localPort: number;
  remoteRoot?: string;
}): Promise<string> {
  const vscodeDirectoryPath = path.resolve(options.cwd, ".vscode");
  const launchJsonPath = path.join(vscodeDirectoryPath, "launch.json");
  const configuration = buildVscodeNodeAttachConfiguration({
    appName: options.appName,
    localPort: options.localPort,
    remoteRoot: options.remoteRoot ?? "/home/vcap/app",
  });

  await fs.ensureDir(vscodeDirectoryPath);

  let launchJson: { version: string; configurations: Array<Record<string, unknown>> } = {
    version: "0.2.0",
    configurations: [],
  };

  if (await fs.pathExists(launchJsonPath)) {
    try {
      const currentContent = await fs.readFile(launchJsonPath, "utf8");
      const parsed = JSON.parse(currentContent) as Partial<typeof launchJson>;
      launchJson = {
        version: typeof parsed.version === "string" ? parsed.version : "0.2.0",
        configurations: Array.isArray(parsed.configurations) ? parsed.configurations as Array<Record<string, unknown>> : [],
      };
    } catch {
      const backupPath = `${launchJsonPath}.backup-${Date.now()}`;
      await fs.copyFile(launchJsonPath, backupPath);
      console.log(chalk.yellow(`Existing launch.json is not valid JSON. Backup created: ${backupPath}`));
    }
  }

  const configurationName = String(configuration.name);
  const existingIndex = launchJson.configurations.findIndex((item) => item.name === configurationName);

  if (existingIndex >= 0) {
    launchJson.configurations[existingIndex] = configuration;
  } else {
    launchJson.configurations.unshift(configuration);
  }

  await fs.writeFile(launchJsonPath, `${JSON.stringify(launchJson, null, 2)}\n`, "utf8");
  return launchJsonPath;
}

function printVscodeAttachInstructions(options: {
  appName: string;
  instanceIndex: string;
  localPort: number;
  launchJsonPath: string;
  inspectorReady?: boolean;
}): void {
  console.log("");

  if (options.inspectorReady === false) {
    console.log(chalk.yellow(`VS Code config was created, but the Node inspector is not reachable yet for ${options.appName} instance ${options.instanceIndex}.`));
    console.log(chalk.yellow("The VS Code debug toolbar appears only after the inspector is reachable and you start the attach config."));
  } else {
    console.log(chalk.green(`VS Code debug config is ready for ${options.appName} instance ${options.instanceIndex}.`));
  }

  console.log(`Launch file: ${chalk.cyan(options.launchJsonPath)}`);
  console.log(`Attach config: ${chalk.cyan(`Attach BTP ${options.appName}`)}`);
  console.log(`Inspector: ${chalk.cyan(`127.0.0.1:${options.localPort}`)}`);
  console.log("");
  console.log(chalk.cyan("How to start debugging in VS Code:"));
  console.log("1. Keep this terminal open. It owns the CF SSH tunnel.");
  console.log("2. Open VS Code Run and Debug panel with Ctrl+Shift+D.");
  console.log(`3. Select ${chalk.cyan(`Attach BTP ${options.appName}`)}.`);
  console.log("4. Press F5 or the green Start Debugging button.");
  console.log("5. Debug buttons such as pause, step over, step into, restart, and stop appear only after attach succeeds.");
  console.log("");
  console.log(chalk.gray("Press Ctrl+C in this terminal to close the tunnel."));
}

async function openVisualStudioCode(options: { cwd: string; debugPanel?: boolean }): Promise<void> {
  const args = options.debugPanel
    ? ["--reuse-window", options.cwd, "--command", "workbench.view.debug"]
    : [options.cwd];
  const result = await runCommand("code", args);

  if (result.exitCode !== 0) {
    console.log(chalk.yellow("Could not open VS Code automatically. Open this folder manually in VS Code."));
    console.log(chalk.gray("Then open Run and Debug with Ctrl+Shift+D."));
    if (result.stderr) console.log(chalk.gray(result.stderr));
  }
}

async function selectDebugMode(options: TCloudFoundryDebugOptions): Promise<TCloudFoundryDebugMode> {
  if (options.check) return "check-ssh";
  if (options.enableSsh) return "enable-ssh";
  if (options.configOnly) return "config-only";
  if (options.linkOnly) return "link-only";
  if (options.chrome) return "chrome";
  if (options.vscode) return "vscode";

  return searchableSelectChoice({
    message: "Select debug mode",
    choices: [
      {
        title: "VS Code guided debugging (recommended)",
        value: "vscode",
        description: "Create launch.json, open VS Code Debug panel, prepare inspector, and open CF SSH tunnel",
      },
      {
        title: "Chrome DevTools / chrome://inspect",
        value: "chrome",
        description: "Open a CF SSH tunnel and print Chrome inspector links",
      },
      {
        title: "Create/update VS Code launch.json only",
        value: "config-only",
        description: "Use when the tunnel is already open or you only need config",
      },
      {
        title: "Print attach links/config only",
        value: "link-only",
        description: "Use when localhost inspector tunnel is already open",
      },
      {
        title: "Check SSH enabled for app",
        value: "check-ssh",
        description: "Run cf ssh-enabled <app>",
      },
      {
        title: "Enable SSH and restart app",
        value: "enable-ssh",
        description: "Run cf enable-ssh <app> and cf restart <app>",
      },
    ],
    allowCustomValue: false,
  }) as Promise<TCloudFoundryDebugMode>;
}

/**
 * Shared cross-region target selector used by every app-scoped CF command
 * (bind/env/logs/debug/request-trace/http-watch). When `--target` is passed it
 * opens the full target switcher directly; otherwise it offers "use current" or
 * "switch across regions". An explicit `app` (or `skipTargetSelect`) keeps the
 * current target untouched.
 */
async function selectCloudFoundryTarget(options: { app?: string; target?: boolean; skipTargetSelect?: boolean; message?: string }): Promise<void> {
  if (options.skipTargetSelect || options.app?.trim()) {
    return;
  }

  // Explicit --target: jump straight into the switcher.
  if (options.target) {
    await runOrgCommand({ switch: true });
    return;
  }

  const target = await ensureCloudFoundrySessionFromCache();

  const currentTargetLabel = [
    target.org ? `org: ${target.org}` : "org: N/A",
    target.space ? `space: ${target.space}` : "space: N/A",
    target.apiEndpoint ? inferCloudFoundryRegionFromApiEndpoint(target.apiEndpoint) : "current region",
  ].join(" · ");

  const action = await searchableSelectChoice({
    message: options.message ?? "Select BTP target",
    choices: [
      { title: `Use current target (${currentTargetLabel})`, value: "current" },
      { title: "Search target across regions and switch", value: "switch" },
    ],
    allowCustomValue: false,
  });

  if (action === "switch") {
    await runOrgCommand({ switch: true });
  }
}

/** Legacy wrapper kept for debug/request-trace/http-watch call sites. */
async function maybeSwitchCloudFoundryTargetForDebug(options: TCloudFoundryDebugOptions): Promise<void> {
  await selectCloudFoundryTarget({ app: options.app, skipTargetSelect: options.skipOrgSelect, message: "Select BTP target for debug" });
}

/**
 * Combined target + app resolver: pick a (possibly cross-region) target, then
 * resolve the app from the cache-first app list. One helper for bind/env/logs.
 */
async function resolveTargetAndApp(options: { app?: string; refresh?: boolean; target?: boolean; skipTargetSelect?: boolean; message: string }): Promise<string> {
  await selectCloudFoundryTarget({ app: options.app, target: options.target, skipTargetSelect: options.skipTargetSelect });
  return resolveAppSelection({ app: options.app, refresh: options.refresh, message: options.message });
}

async function selectDebugInstance(options: TCloudFoundryDebugOptions): Promise<string> {
  if (options.instance?.trim()) {
    return options.instance.trim();
  }

  return searchableSelectChoice({
    message: "Select app instance index",
    choices: [
      { title: "0", value: "0" },
      { title: "1", value: "1" },
      { title: "2", value: "2" },
      { title: "3", value: "3" },
    ],
    validateCustomValue: (value) => /^\d+$/.test(value.trim()) ? true : "Instance index must be a number",
    customValueTitle: (value) => `Use typed instance index: ${value}`,
  });
}

async function selectDebugPort(options: { value?: string; message: string; defaultPort: number }): Promise<number> {
  if (options.value?.trim()) {
    return parsePositivePort(options.value, options.defaultPort);
  }

  const portValue = await searchableSelectChoice({
    message: options.message,
    choices: [
      { title: `${options.defaultPort} recommended`, value: String(options.defaultPort) },
      { title: "9230", value: "9230" },
      { title: "9231", value: "9231" },
    ],
    validateCustomValue: (value) => {
      try {
        parsePositivePort(value, options.defaultPort);
        return true;
      } catch (error) {
        return error instanceof Error ? error.message : "Invalid port";
      }
    },
    customValueTitle: (value) => `Use typed port: ${value}`,
  });

  return parsePositivePort(portValue, options.defaultPort);
}

function shouldIncludeLogLine(line: string, options: { instance?: string; process?: string }): boolean {
  const trimmedInstance = options.instance?.trim();
  const trimmedProcess = options.process?.trim();

  if (!trimmedInstance && !trimmedProcess) {
    return true;
  }

  const normalizedLine = line.toLowerCase();

  if (trimmedProcess) {
    const normalizedProcess = trimmedProcess.toLowerCase();

    if (!normalizedLine.includes(`[app/proc/${normalizedProcess}/`) && !normalizedLine.includes(`[app/${normalizedProcess}/`)) {
      return false;
    }
  }

  if (trimmedInstance) {
    const instancePattern = new RegExp(`\\/(?:${trimmedInstance})\\]`, "i");

    if (!instancePattern.test(line)) {
      return false;
    }
  }

  return true;
}

function filterCloudFoundryLogsOutput(output: string, options: { instance?: string; process?: string }): string {
  return output
    .split(/\r?\n/)
    .filter((line) => shouldIncludeLogLine(line, options))
    .join("\n");
}

function writeFilteredLogChunk(
  chunk: Buffer,
  options: {
    instance?: string;
    process?: string;
    outputStream?: nodeFs.WriteStream;
    isError?: boolean;
  },
): void {
  const text = chunk.toString("utf8");
  const filteredText = filterCloudFoundryLogsOutput(text, options);

  if (!filteredText.trim()) {
    return;
  }

  const outputText = filteredText.endsWith("\n") ? filteredText : `${filteredText}\n`;

  if (options.isError) {
    process.stderr.write(outputText);
  } else {
    process.stdout.write(outputText);
  }

  options.outputStream?.write(outputText);
}

async function refreshAppsCacheForCurrentTarget(): Promise<TCloudFoundryApp[]> {
  const target = await readCloudFoundryTarget();
  const targetKey = buildCloudFoundryTargetKey(target);
  const apps = await listCloudFoundryApps();
  await rememberCloudFoundryApps(targetKey, apps);
  return apps;
}

function refreshAppsCacheInDetachedProcess(): void {
  const entryFilePath = process.argv[1];

  if (!entryFilePath) {
    return;
  }

  const childProcess = spawn(process.execPath, [entryFilePath, "cf", "apps-cache-refresh"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });

  childProcess.unref();
}

async function getAppsWithCache(options: { refresh?: boolean; startBackgroundRefresh?: boolean }): Promise<TCloudFoundryApp[]> {
  await ensureCloudFoundrySessionFromCache();

  if (options.refresh) {
    return refreshAppsCacheForCurrentTarget();
  }

  const target = await readCloudFoundryTarget();
  const targetKey = buildCloudFoundryTargetKey(target);
  const cache = await readCache();
  const cachedEntry = cache.cloudFoundry.appListsByTarget[targetKey];

  if (cachedEntry?.apps.length) {
    if (options.startBackgroundRefresh) {
      refreshAppsCacheInDetachedProcess();
    }

    return cachedEntry.apps;
  }

  return refreshAppsCacheForCurrentTarget();
}

async function resolveAppSelection(options: { app?: string; refresh?: boolean; message: string }): Promise<string> {
  if (options.app?.trim()) {
    await rememberSelectedApp(options.app.trim());
    return options.app.trim();
  }

  const apps = await getAppsWithCache({ refresh: options.refresh, startBackgroundRefresh: !options.refresh });
  const cache = await readCache();
  const cachedSelectedAppNames = cache.cloudFoundry.selectedApps;
  const cachedSelectedApps = cachedSelectedAppNames
    .filter((appName) => !apps.some((app) => app.name === appName))
    .map((appName) => ({ title: `${appName} ${chalk.gray("cached selected")}`, value: appName }));

  const appName = await searchableSelectChoice({
    message: options.message,
    choices: [
      ...apps.map((app) => ({
        title: [app.name, app.requestedState, app.routes].filter(Boolean).join(" | "),
        value: app.name,
      })),
      ...cachedSelectedApps,
    ],
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed app name: ${value}`,
  });

  await rememberSelectedApp(appName);
  return appName;
}

function printTarget(target: TCloudFoundryTarget, ctx: TInteractionContext = getDefaultInteractionContext()): void {
  ctx.interaction.notify({
    level: "info",
    message: [
      `API Endpoint: ${target.apiEndpoint ?? "N/A"}`,
      `User: ${target.user ?? "N/A"}`,
      `Org: ${target.org ?? "N/A"}`,
      `Space: ${target.space ?? "N/A"}`,
    ].join("\n"),
  });
}

const DEFAULT_CLOUD_FOUNDRY_API_ENDPOINTS = [
  "https://api.cf.br10.hana.ondemand.com",
  "https://api.cf.eu10.hana.ondemand.com",
  "https://api.cf.eu10-004.hana.ondemand.com",
  "https://api.cf.eu10-005.hana.ondemand.com",
  "https://api.cf.eu20.hana.ondemand.com",
  "https://api.cf.eu20-001.hana.ondemand.com",
  "https://api.cf.eu20-002.hana.ondemand.com",
  "https://api.cf.us10.hana.ondemand.com",
  "https://api.cf.us10-001.hana.ondemand.com",
  "https://api.cf.us11.hana.ondemand.com",
  "https://api.cf.us20.hana.ondemand.com",
  "https://api.cf.us21.hana.ondemand.com",
  "https://api.cf.ap10.hana.ondemand.com",
  "https://api.cf.ap11.hana.ondemand.com",
  "https://api.cf.ap20.hana.ondemand.com",
  "https://api.cf.ap21.hana.ondemand.com",
  "https://api.cf.jp10.hana.ondemand.com",
  "https://api.cf.ca10.hana.ondemand.com",
  "https://api.cf.ch20.hana.ondemand.com",
  "https://api.cf.sa10.hana.ondemand.com",
];

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

async function selectCloudFoundryApiEndpoint(options: {
  api?: string;
  cachedApiEndpoints: string[];
}): Promise<string> {
  if (options.api?.trim()) {
    return options.api.trim();
  }

  const cachedApiEndpoints = uniqueValues(options.cachedApiEndpoints);

  if (cachedApiEndpoints.length === 1) {
    return cachedApiEndpoints[0];
  }

  const choices = [
    ...cachedApiEndpoints.map((apiEndpoint) => ({
      title: `${apiEndpoint} ${chalk.gray("cached")}`,
      value: apiEndpoint,
    })),
    ...DEFAULT_CLOUD_FOUNDRY_API_ENDPOINTS
      .filter((apiEndpoint) => !cachedApiEndpoints.includes(apiEndpoint))
      .map((apiEndpoint) => ({ title: apiEndpoint, value: apiEndpoint })),
    { title: "Enter CF API endpoint manually", value: "__ENTER_MANUAL__" },
  ];

  return searchableSelectChoice({
    message: "Select CF API endpoint",
    choices: choices.filter((choice) => choice.value !== "__ENTER_MANUAL__"),
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed CF API endpoint: ${value}`,
  });
}

async function selectCloudFoundryOrganization(options: {
  org?: string;
  cachedOrganizations: string[];
}): Promise<string> {
  if (options.org?.trim()) {
    return options.org.trim();
  }

  const organizations = await listCloudFoundryOrganizations();

  if (organizations.length === 0) {
    return selectFromHistoryOrInput({
      message: "Select CF org",
      values: options.cachedOrganizations,
      initialValue: options.cachedOrganizations[0],
      validate: validateRequired,
    });
  }

  return searchableSelectChoice({
    message: "Select CF org",
    choices: organizations.map((organization) => ({ title: organization, value: organization })),
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed CF org: ${value}`,
  });
}

async function selectCloudFoundrySpace(options: {
  space?: string;
  cachedSpaces: string[];
}): Promise<string | undefined> {
  if (options.space?.trim()) {
    return options.space.trim();
  }

  const spaces = await listCloudFoundrySpaces();

  if (spaces.length === 0) {
    return selectFromHistoryOrInput({
      message: "Select CF space",
      values: options.cachedSpaces,
      initialValue: options.cachedSpaces[0] ?? "app",
    });
  }

  const initialSpace = spaces.includes("app") ? "app" : spaces[0];

  return searchableSelectChoice({
    message: "Select CF space",
    choices: [
      ...spaces
        .filter((space) => space === initialSpace)
        .map((space) => ({ title: space, value: space })),
      ...spaces
        .filter((space) => space !== initialSpace)
        .map((space) => ({ title: space, value: space })),
    ],
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed CF space: ${value}`,
  });
}

async function runLoginCommand(options: TCloudFoundryLoginOptions): Promise<void> {
  await ensureExternalTool("cf");
  const cache = await readCache();
  const lastProfile = cache.cloudFoundry.loginProfiles[0];
  const apiEndpoint = await selectCloudFoundryApiEndpoint({
    api: options.api,
    cachedApiEndpoints: cache.cloudFoundry.loginProfiles.map((item) => item.apiEndpoint),
  });

  const username = options.username ?? await selectFromHistoryOrInput({
    message: "Select CF username",
    values: cache.cloudFoundry.loginProfiles.map((item) => item.username),
    initialValue: lastProfile?.username,
    validate: validateRequired,
  });

  let password = options.password ?? lastProfile?.password;
  let shouldSavePassword = options.savePassword ?? false;

  if (!password) {
    const response = await prompts({
      type: "password",
      name: "password",
      message: "Enter CF password",
      validate: validateRequired,
    });

    if (!response.password) {
      throw new Error("Cancelled");
    }

    password = response.password as string;
  } else {
    const response = await prompts({
      type: "select",
      name: "useCachedPassword",
      message: "Use cached password?",
      choices: [
        { title: "Yes", value: true },
        { title: "No, enter password again", value: false },
      ],
      initial: 0,
    });

    if (!response.useCachedPassword) {
      const passwordResponse = await prompts({
        type: "password",
        name: "password",
        message: "Enter CF password",
        validate: validateRequired,
      });

      if (!passwordResponse.password) {
        throw new Error("Cancelled");
      }

      password = passwordResponse.password as string;
    }
  }

  if (!shouldSavePassword) {
    const savePasswordResponse = await prompts({
      type: "select",
      name: "savePassword",
      message: "Save password for automatic re-login and region scan?",
      choices: [
        { title: "Yes, save password on this machine", value: true },
        { title: "No", value: false },
      ],
      initial: 0,
    });

    shouldSavePassword = Boolean(savePasswordResponse.savePassword);
  }

  const apiExitCode = await setCloudFoundryApiEndpoint(apiEndpoint);

  if (apiExitCode !== 0) {
    process.exitCode = apiExitCode;
    return;
  }

  const authExitCode = await authenticateCloudFoundry({ username, password });

  if (authExitCode !== 0) {
    process.exitCode = authExitCode;
    return;
  }

  const org = await selectCloudFoundryOrganization({
    org: options.org,
    cachedOrganizations: cache.cloudFoundry.loginProfiles
      .filter((item) => item.apiEndpoint === apiEndpoint && item.username === username)
      .map((item) => item.org),
  });

  const orgExitCode = await targetCloudFoundryOrg(org);

  if (orgExitCode !== 0) {
    process.exitCode = orgExitCode;
    return;
  }

  const space = await selectCloudFoundrySpace({
    space: options.space,
    cachedSpaces: cache.cloudFoundry.loginProfiles
      .filter((item) => item.apiEndpoint === apiEndpoint && item.username === username && item.org === org)
      .map((item) => item.space ?? "")
      .filter(Boolean),
  });

  if (space) {
    const spaceExitCode = await targetCloudFoundrySpace(space);

    if (spaceExitCode !== 0) {
      process.exitCode = spaceExitCode;
      return;
    }
  }

  await rememberCloudFoundryLoginProfile({
    apiEndpoint,
    username,
    org,
    space,
    password: shouldSavePassword ? password : undefined,
    updatedAt: new Date().toISOString(),
  });

  if (shouldSavePassword) {
    console.log(chalk.yellow("Password was cached in ~/.simplemdg/cache.json for automatic re-login. Do not use this on shared machines."));
  }

  console.log(chalk.green("CF login completed."));
}


function formatCloudFoundryOrgEntry(entry: TCloudFoundryOrgEntry, target: TCloudFoundryTarget): string {
  const isCurrent = entry.apiEndpoint === target.apiEndpoint && entry.org === target.org;
  const spaceText = typeof entry.spaceCount === "number"
    ? `${entry.spaceCount} ${entry.spaceCount === 1 ? "space" : "spaces"}`
    : "spaces unknown";
  return `${entry.org} ${chalk.gray(`${entry.region} · ${spaceText}${isCurrent ? " · current" : ""}`)}`;
}

async function getCloudFoundryApiEndpointsForOrgSearch(options: { api?: string }, target: TCloudFoundryTarget, cache: Awaited<ReturnType<typeof readCache>>): Promise<string[]> {
  // When a specific endpoint is requested, scan only that one.
  if (options.api?.trim()) {
    return uniqueValues([options.api]);
  }

  // The user-managed region registry is the source of truth for which regions
  // to scan; fall back to the built-in defaults if it is somehow empty.
  const enabledRegionEndpoints = await getEnabledRegionEndpoints();
  const baseRegionEndpoints = enabledRegionEndpoints.length ? enabledRegionEndpoints : DEFAULT_CLOUD_FOUNDRY_API_ENDPOINTS;

  return uniqueValues([
    target.apiEndpoint ?? "",
    ...cache.cloudFoundry.loginProfiles.map((item) => item.apiEndpoint),
    ...cache.cloudFoundry.orgsAcrossRegions.map((item) => item.apiEndpoint),
    ...baseRegionEndpoints,
  ]);
}

async function getCloudFoundryOrganizationsAcrossRegions(options: { api?: string; refresh?: boolean }): Promise<TCloudFoundryOrgEntry[]> {
  const target = await readCloudFoundryTarget();
  const cache = await readCache();
  const cachedEntries = cache.cloudFoundry.orgsAcrossRegions ?? [];

  const cachedRegionCount = new Set(cachedEntries.map((entry) => entry.region)).size;

  if (!options.refresh && cachedEntries.length && cachedRegionCount > 1) {
    return cachedEntries.sort((left, right) => {
      const byOrg = left.org.localeCompare(right.org);
      return byOrg !== 0 ? byOrg : left.region.localeCompare(right.region);
    });
  }

  const apiEndpoints = await getCloudFoundryApiEndpointsForOrgSearch(options, target, cache);
  console.log(chalk.gray(`Searching CF orgs across ${apiEndpoints.length} region endpoint(s)...`));
  const credentials = cache.cloudFoundry.loginProfiles.map((profile) => ({
    apiEndpoint: profile.apiEndpoint,
    username: profile.username,
    password: profile.password,
  }));
  const entries = await scanCloudFoundryOrganizationsAcrossRegions(apiEndpoints, credentials);

  if (entries.length) {
    const regionCount = new Set(entries.map((entry) => entry.region)).size;
    console.log(chalk.green(`Found ${entries.length} org(s) across ${regionCount} region(s).`));
    await rememberCloudFoundryOrgEntries(entries);
    return entries;
  }

  const currentOrganizations = await listCloudFoundryOrganizations().catch(() => []);
  const currentRegion = target.apiEndpoint ? inferCloudFoundryRegionFromApiEndpoint(target.apiEndpoint) : "current";
  const fallbackEntries = currentOrganizations.map((organization) => ({
    apiEndpoint: target.apiEndpoint ?? "",
    region: currentRegion,
    org: organization,
    updatedAt: new Date().toISOString(),
  }));

  if (fallbackEntries.length) {
    await rememberCloudFoundryOrgEntries(fallbackEntries);
  }

  return fallbackEntries;
}

function orgEntryToTarget(entry: TCloudFoundryOrgEntry): TCfTarget {
  return { region: entry.region, apiEndpoint: entry.apiEndpoint, org: entry.org, space: "", lastRefreshedAt: entry.updatedAt };
}

function dedupeTargets(targets: TCfTarget[]): TCfTarget[] {
  const seen = new Set<string>();
  const result: TCfTarget[] = [];

  for (const target of targets) {
    const key = cfTargetKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }

  return result;
}

async function switchToCfTarget(target: TCfTarget, options: { space?: string }, ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  const apiEndpoint = target.apiEndpoint;

  if (!apiEndpoint) {
    throw new Error("Cannot determine CF API endpoint for the selected target.");
  }

  const region = target.region || inferCloudFoundryRegionFromApiEndpoint(apiEndpoint);
  const authenticatedProfile = await ensureCloudFoundryAuthenticatedForApiEndpoint({
    apiEndpoint,
    preferredOrg: target.org,
    preferredSpace: options.space ?? target.space,
    reason: "switch-target",
  }, ctx);

  const orgExitCode = await targetCloudFoundryOrg(target.org);

  if (orgExitCode !== 0) {
    ctx.interaction.notify({ level: "warn", message: "Cannot switch to this org after automatic authentication." });
    ctx.interaction.notify({ level: "muted", message: "Run smdg cf login, save the password, then try again." });
    process.exitCode = orgExitCode;
    return;
  }

  let space = options.space?.trim() || target.space?.trim() || "";

  if (!space) {
    const spaces = await listCloudFoundrySpaces().catch(() => [] as string[]);
    const currentAfter = await readCloudFoundryTarget();
    const preferred = currentAfter.space || (spaces.includes("app") ? "app" : spaces[0]);
    space = spaces.length
      ? await ctx.interaction.select({
        message: "Select CF space",
        choices: [
          ...spaces.filter((s) => s === preferred).map((s) => ({ title: `${s} ${chalk.gray("suggested")}`, value: s })),
          ...spaces.filter((s) => s !== preferred).map((s) => ({ title: s, value: s })),
        ],
        validateCustomValue: validateRequired,
        customValueTitle: (value) => `Use typed CF space: ${value}`,
      })
      : await ctx.interaction.input({ message: "Enter CF space", initial: "app" });
  }

  if (space) {
    const spaceExitCode = await targetCloudFoundrySpace(space);
    if (spaceExitCode !== 0) {
      process.exitCode = spaceExitCode;
      return;
    }
  }

  await addRecentTarget({ region, apiEndpoint, org: target.org, space });

  if (authenticatedProfile?.password) {
    await rememberCloudFoundryLoginProfile({ ...authenticatedProfile, apiEndpoint, org: target.org, space, updatedAt: new Date().toISOString() });
  }

  ctx.interaction.notify({ level: "success", message: "CF target switched." });
  printTarget(await readCloudFoundryTarget(), ctx);

  if (!(await isFavoriteTarget({ region, apiEndpoint, org: target.org, space }))) {
    // Deliberately NOT the raw `prompts({type:"confirm"})` call this used to be: that widget
    // crashes (`Cannot read properties of undefined (reading 'toLowerCase')`) on any keypress it
    // doesn't recognize as y/n/Enter/Escape (e.g. an arrow key, a pasted sequence). Routing
    // through ctx.interaction.confirm() means the Ink shell never touches that code at all.
    const favorite = await ctx.interaction.confirm({ message: "Mark this target as favorite?", initial: false });
    if (favorite) {
      await addFavoriteTarget({ region, apiEndpoint, org: target.org, space });
      ctx.interaction.notify({ level: "muted", message: "Added to favorites." });
    }
  }
}

async function manageFavoriteTargets(favorites: TCfTarget[], ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  if (!favorites.length) {
    ctx.interaction.notify({ level: "muted", message: "No favorites yet. Switch to a target and choose to favorite it." });
    return;
  }

  const selected = await ctx.interaction.select({
    message: "Favorites — select one to remove",
    choices: [
      ...favorites.map((target, index) => ({ title: `★ ${cfTargetLabel(target)}`, value: String(index) })),
      { title: "Cancel", value: "__cancel__" },
    ],
    allowCustomValue: false,
  });

  if (selected === "__cancel__") {
    return;
  }

  await removeFavoriteTarget(favorites[Number(selected)]);
  ctx.interaction.notify({ level: "success", message: "Removed from favorites." });
}

function printTargetSections(favorites: TCfTarget[], recent: TCfTarget[], orgEntries: TCloudFoundryOrgEntry[], current: TCloudFoundryTarget, ctx: TInteractionContext = getDefaultInteractionContext()): void {
  const lines: string[] = [chalk.bold("CF Target Switcher"), ""];

  if (favorites.length) {
    lines.push(chalk.yellow("Favorites"));
    favorites.forEach((target) => lines.push(`  ${chalk.yellow("★")} ${cfTargetLabel(target)}`));
    lines.push("");
  }

  if (recent.length) {
    lines.push(chalk.cyan("Recent"));
    recent.forEach((target) => lines.push(`  ${chalk.gray("◷")} ${cfTargetLabel(target)}`));
    lines.push("");
  }

  lines.push(chalk.gray(`All Targets (${orgEntries.length})`));
  for (const entry of orgEntries) {
    const marker = entry.apiEndpoint === current.apiEndpoint && entry.org === current.org ? chalk.green("*") : " ";
    lines.push(`${marker} ${entry.region} / ${entry.org}`);
  }

  ctx.interaction.notify({ level: "info", message: lines.join("\n") });
}

/** Shared with the interactive shell's CfOrgScreen, which launches with no CLI flags at all. */
export async function runOrgCommand(options: TCloudFoundryOrgOptions, ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  const latestTarget = await readCloudFoundryTarget();
  const favorites = await listFavoriteTargets();
  const recent = await listRecentTargets();

  // Direct switch via flags.
  if (options.org?.trim()) {
    await ensureExternalTool("cf");
    const apiEndpoint = options.api?.trim() || latestTarget.apiEndpoint || "";
    const region = inferCloudFoundryRegionFromApiEndpoint(apiEndpoint || "current");
    await switchToCfTarget({ region, apiEndpoint, org: options.org.trim(), space: options.space?.trim() || "" }, { space: options.space }, ctx);
    return;
  }

  // Cross-region status line (instant, from cache).
  const status = await getCrossRegionStatus();
  if (status.totalTargets) {
    ctx.interaction.notify({ level: "muted", message: `Using cached targets · ${status.totalTargets} targets · updated ${formatRelativeTime(status.lastUpdatedAt)}` });
  }

  const action = options.list
    ? "list"
    : options.switch
      ? "switch"
      : await ctx.interaction.select({
        message: "CF target switcher",
        choices: [
          { title: "Switch to a target (favorites, recent, all)", value: "switch" },
          { title: "Refresh all regions", value: "refresh" },
          { title: "List targets", value: "list" },
          { title: "Manage favorites", value: "favorites" },
          { title: "Manage regions", value: "regions" },
          { title: "Show current target", value: "current" },
        ],
        allowCustomValue: false,
      });

  if (action === "current") {
    printTarget(latestTarget, ctx);
    return;
  }

  if (action === "favorites") {
    await manageFavoriteTargets(favorites, ctx);
    return;
  }

  if (action === "regions") {
    await runRegionInteractiveCommand(ctx);
    return;
  }

  let allTargets: TCfTarget[];

  if (action === "refresh" || options.refresh) {
    await ensureExternalTool("cf");
    ctx.interaction.notify({ level: "muted", message: "Refreshing CF targets across enabled regions..." });
    const cache = await readCache();
    const credentials = cache.cloudFoundry.loginProfiles.map((profile) => ({
      apiEndpoint: profile.apiEndpoint,
      username: profile.username,
      password: profile.password,
    }));
    const summary = await scanCrossRegionTargets({ credentials });
    const refreshLines = summary.regionResults.map((region) => {
      const tag = region.status === "success" ? chalk.green("success") : chalk.red("failed");
      const suffix = region.status === "failed" && region.usedCache ? chalk.gray(" · using cached result") : "";
      return `  ${region.region.padEnd(8)} ${tag} · ${region.targetCount} targets${suffix}`;
    });
    ctx.interaction.notify({ level: "info", message: refreshLines.join("\n") });
    ctx.interaction.notify({ level: "success", message: `Refresh completed · ${summary.totalTargets} target(s) across ${summary.regionResults.length} region(s).` });
    allTargets = summary.targets;
  } else {
    // Cross-region cache first; fall back to legacy orgsAcrossRegions cache.
    allTargets = await listCrossRegionTargets();
    if (!allTargets.length) {
      const cache = await readCache();
      allTargets = (cache.cloudFoundry.orgsAcrossRegions ?? []).map(orgEntryToTarget);
    }
  }

  if (action === "list") {
    printTargetSections(favorites, recent, allTargets.map((t) => ({ apiEndpoint: t.apiEndpoint, region: t.region, org: t.org, updatedAt: t.lastRefreshedAt ?? "" })), latestTarget, ctx);
    return;
  }

  const recentKeys = new Set(recent.map((target) => cfTargetKey(target)));
  const combined = dedupeTargets([...favorites, ...recent, ...allTargets]);

  if (!combined.length) {
    const cacheAfter = await readCache();
    const hasCredentials = cacheAfter.cloudFoundry.loginProfiles.some((item) => item.password?.trim());

    if (!hasCredentials) {
      const loggedIn = await promptAndLoginCloudFoundryInteractively({ reason: "No cached CF targets and no login found." }, ctx);
      if (loggedIn) {
        ctx.interaction.notify({ level: "muted", message: "Login succeeded. Re-run: smdg cf org --refresh to scan your BTP regions." });
      }
    } else {
      ctx.interaction.notify({ level: "warn", message: "No cached targets yet." });
      ctx.interaction.notify({ level: "muted", message: "Choose 'Refresh all regions', or run smdg cf login and save the password." });
    }
    return;
  }

  const selectedIndex = await ctx.interaction.select({
    message: `Select CF target (${favorites.length} favorite · ${recent.length} recent · ${allTargets.length} all)`,
    choices: combined.map((target, index) => {
      const marker = target.isFavorite ? chalk.yellow("★ ") : recentKeys.has(cfTargetKey(target)) ? chalk.gray("◷ ") : "  ";
      const meta = [
        target.environment && target.environment !== "UNKNOWN" ? target.environment : "",
        typeof target.cachedAppCount === "number" ? `${target.cachedAppCount} apps cached` : "",
      ].filter(Boolean).join(" · ");
      const suffix = meta ? chalk.gray(`  (${meta})`) : "";
      return { title: `${marker}${cfTargetLabel(target)}${suffix}`, value: String(index) };
    }),
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed org in current region: ${value}`,
  });

  const chosen = combined[Number(selectedIndex)] ?? {
    region: inferCloudFoundryRegionFromApiEndpoint(latestTarget.apiEndpoint ?? "current"),
    apiEndpoint: latestTarget.apiEndpoint ?? "",
    org: selectedIndex,
    space: "",
  };

  await ensureExternalTool("cf");
  await switchToCfTarget(chosen, { space: options.space }, ctx);
}

async function runAppsCommand(options: TCloudFoundryAppsOptions): Promise<void> {
  const target = await ensureCloudFoundrySessionFromCache();
  printTarget(target);
  console.log("");

  const region = target.apiEndpoint ? inferCloudFoundryRegionFromApiEndpoint(target.apiEndpoint) : "current";
  const cacheKey = buildCfAppsKey(region, target.org ?? "?", target.space ?? "?");
  const targetLabel = `${region} / ${target.org ?? "?"} / ${target.space ?? "?"}`;

  const result = await smartRead<TCloudFoundryApp[]>({
    namespace: "cf-apps",
    key: cacheKey,
    ttlMs: DEFAULT_CACHE_TTL.cfApps,
    mode: options.refresh ? "network-only" : "stale-while-revalidate",
    fetcher: listCloudFoundryApps,
  });

  if (result.fromCache) {
    console.log(chalk.gray(`Using cached apps for ${targetLabel} from ${formatRelativeTime(result.updatedAt)}.`));
    if (result.isRefreshing) {
      console.log(chalk.gray("Refreshing apps in background..."));
    }
    console.log("");
  }

  if (options.select) {
    const appName = await resolveAppSelection({ message: "Select BTP app", refresh: options.refresh });
    console.log(appName);
    return;
  }

  for (const app of result.data) {
    console.log([app.name, app.requestedState, app.processes, app.routes].filter(Boolean).join(" | "));
  }

  // Mirror the smart-cache apps into the legacy per-target cache used by
  // resolveAppSelection so bind/debug/logs stay in sync.
  await rememberCloudFoundryApps(buildCloudFoundryTargetKey(target), result.data).catch(() => undefined);

  if (result.refreshPromise) {
    try {
      const fresh = await result.refreshPromise;
      await rememberCloudFoundryApps(buildCloudFoundryTargetKey(target), fresh).catch(() => undefined);
      console.log("");
      console.log(chalk.gray("Background refresh completed. Cache updated."));
    } catch (error) {
      console.log("");
      console.log(chalk.yellow(`Background refresh failed: ${error instanceof Error ? error.message : String(error)}`));
      console.log(chalk.gray("Showing cached apps. Run smdg cf login if your session expired."));
    }
  }
}

async function runAppsCacheRefreshCommand(): Promise<void> {
  await refreshAppsCacheForCurrentTarget();
}

async function runBindCommand(options: TCloudFoundryBindOptions): Promise<void> {
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const appName = await resolveTargetAndApp({ app: options.app, refresh: options.refresh, target: options.target, message: "Select app to cds bind" });
  const exitCode = await runCommandInherit("cds", ["bind", "--to-app-services", appName], { cwd: repositoryPath });
  process.exitCode = exitCode;
}

async function runEnvCommand(options: TCloudFoundryEnvOptions): Promise<void> {
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const appName = await resolveTargetAndApp({ app: options.app, refresh: options.refresh, target: options.target, message: "Select app to export cf env" });
  const cache = await readCache();

  const outputFileName = options.out ?? await selectFromHistoryOrInput({
    message: "Select output env file name",
    values: cache.cloudFoundry.envFileNames,
    initialValue: cache.cloudFoundry.envFileNames[0] ?? "default-env.json",
    validate: validateRequired,
  });

  const result = await runCommand("cf", ["env", appName]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "cf env failed");
  }

  const outputPath = path.resolve(repositoryPath, outputFileName);

  if (options.raw) {
    await fs.writeFile(outputPath, result.stdout, "utf8");
  } else {
    const parsedEnvironment = parseCloudFoundryEnvironment(result.stdout);
    await fs.writeJson(outputPath, parsedEnvironment, { spaces: 2 });
  }

  await rememberSelectedApp(appName);
  await rememberEnvironmentFileName(outputFileName);

  console.log(chalk.green(`Exported ${options.raw ? "raw env" : "clean JSON env"} to ${outputPath}`));
}


async function runLogsCommand(options: TCloudFoundryLogsOptions): Promise<void> {
  const appName = await resolveTargetAndApp({ app: options.app, refresh: options.refresh, target: options.target, message: "Select app to view logs" });
  const shouldFollow = options.follow || !options.recent;
  const shouldReadRecent = options.recent || !shouldFollow;
  const outputPath = options.out ? path.resolve(process.cwd(), options.out) : undefined;

  if (outputPath) {
    await fs.ensureDir(path.dirname(outputPath));
  }

  if (shouldReadRecent && !shouldFollow) {
    const result = await runCommand("cf", buildCloudFoundryLogsArgs({ appName, recent: true }));
    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const filteredOutput = filterCloudFoundryLogsOutput(combinedOutput, {
      instance: options.instance,
      process: options.process,
    });

    if (outputPath) {
      await fs.writeFile(outputPath, filteredOutput.endsWith("\n") ? filteredOutput : `${filteredOutput}\n`, "utf8");
      console.log(chalk.green(`Exported recent logs to ${outputPath}`));
    } else {
      console.log(filteredOutput);
    }

    process.exitCode = result.exitCode;
    return;
  }

  const outputStream = outputPath ? nodeFs.createWriteStream(outputPath, { flags: "a" }) : undefined;

  if (outputPath) {
    console.log(chalk.gray(`Streaming logs and appending to ${outputPath}`));
  }

  console.log(chalk.gray("Press Ctrl+C to stop realtime logs."));

  const childProcess = spawn("cf", buildCloudFoundryLogsArgs({ appName, recent: false }), {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  childProcess.stdout?.on("data", (chunk: Buffer) => {
    writeFilteredLogChunk(chunk, {
      instance: options.instance,
      process: options.process,
      outputStream,
    });
  });

  childProcess.stderr?.on("data", (chunk: Buffer) => {
    writeFilteredLogChunk(chunk, {
      instance: options.instance,
      process: options.process,
      outputStream,
      isError: true,
    });
  });

  childProcess.on("close", (exitCode) => {
    outputStream?.end();
    process.exitCode = exitCode ?? 0;
  });

  // Without this, Ctrl+C had no listener on this process, so Node's default
  // SIGINT disposition terminated `smdg` immediately without ever killing the
  // spawned `cf logs` grandchild (its stdio isn't inherited, so it doesn't
  // receive the console's Ctrl+C broadcast the same way) — an orphaned
  // `cf logs` process kept streaming in the background.
  process.once("SIGINT", () => {
    console.log(chalk.gray("\nStopping realtime logs..."));
    if (!childProcess.killed) childProcess.kill();
    outputStream?.end();
    process.exit(0);
  });

  await new Promise<void>((resolve) => {
    childProcess.on("close", () => resolve());
  });
}


async function runSshCommand(options: TCloudFoundrySshOptions): Promise<void> {
  const appName = await resolveTargetAndApp({ app: options.app, refresh: options.refresh, target: options.target, message: "Select app to SSH into" });
  const instanceIndex = await selectDebugInstance({ instance: options.instance });

  await ensureSshEnabledForDebug(appName);
  await rememberSelectedApp(appName);

  console.log(chalk.gray(`Connecting: cf ssh ${appName} -i ${instanceIndex}`));
  console.log(chalk.gray("Press Ctrl+C or type 'exit' to close the session."));

  const exitCode = await runCommandInherit("cf", ["ssh", appName, "-i", instanceIndex]);
  process.exitCode = exitCode;
}


type TInspectorProtocolMessage = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
};

type TInspectorWebSocketInfo = {
  host: string;
  port: number;
  path: string;
};

function parseWebSocketUrl(value: string): TInspectorWebSocketInfo {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 80),
    path: `${url.pathname}${url.search}`,
  };
}

async function getNodeInspectorWebSocketUrl(localPort: number): Promise<string | undefined> {
  const response = await fetch(`http://127.0.0.1:${localPort}/json/list`);

  if (!response.ok) {
    return undefined;
  }

  const targets = await response.json() as Array<{ webSocketDebuggerUrl?: string }>;
  return targets.find((target) => target.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
}

async function waitForNodeInspectorWebSocketUrl(localPort: number, timeoutMs = 15000): Promise<string | undefined> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const webSocketUrl = await getNodeInspectorWebSocketUrl(localPort);

      if (webSocketUrl) {
        return webSocketUrl;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (lastError instanceof Error) {
    console.log(chalk.gray(`Could not read inspector WebSocket yet: ${lastError.message}`));
  }

  return undefined;
}

function encodeWebSocketFrame(payload: string): Buffer {
  const payloadBuffer = Buffer.from(payload, "utf8");
  const maskKey = crypto.randomBytes(4);
  let header: Buffer;

  if (payloadBuffer.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | payloadBuffer.length;
  } else if (payloadBuffer.length <= 0xffff) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payloadBuffer.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payloadBuffer.length), 2);
  }

  const maskedPayload = Buffer.alloc(payloadBuffer.length);

  for (let index = 0; index < payloadBuffer.length; index += 1) {
    maskedPayload[index] = payloadBuffer[index] ^ maskKey[index % 4];
  }

  return Buffer.concat([header, maskKey, maskedPayload]);
}

function decodeWebSocketFrames(buffer: Buffer): { messages: string[]; remaining: Buffer } {
  const messages: string[] = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const firstByte = buffer[offset];
    const secondByte = buffer[offset + 1];
    const opcode = firstByte & 0x0f;
    const isMasked = Boolean(secondByte & 0x80);
    let payloadLength = secondByte & 0x7f;
    let headerLength = 2;

    if (payloadLength === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (offset + 10 > buffer.length) break;
      const longLength = buffer.readBigUInt64BE(offset + 2);

      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("WebSocket frame is too large");
      }

      payloadLength = Number(longLength);
      headerLength = 10;
    }

    const maskLength = isMasked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;

    if (offset + frameLength > buffer.length) {
      break;
    }

    let payload = buffer.subarray(offset + headerLength + maskLength, offset + frameLength);

    if (isMasked) {
      const maskKey = buffer.subarray(offset + headerLength, offset + headerLength + 4);
      const unmaskedPayload = Buffer.alloc(payload.length);

      for (let index = 0; index < payload.length; index += 1) {
        unmaskedPayload[index] = payload[index] ^ maskKey[index % 4];
      }

      payload = unmaskedPayload;
    }

    if (opcode === 0x1) {
      messages.push(payload.toString("utf8"));
    }

    offset += frameLength;
  }

  return { messages, remaining: buffer.subarray(offset) };
}

async function sendInspectorEvaluateCommand(options: {
  webSocketUrl: string;
  expression: string;
  timeoutMs?: number;
}): Promise<void> {
  const connection = parseWebSocketUrl(options.webSocketUrl);
  const timeoutMs = options.timeoutMs ?? 10000;
  const key = crypto.randomBytes(16).toString("base64");
  const request = [
    `GET ${connection.path} HTTP/1.1`,
    `Host: ${connection.host}:${connection.port}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ].join("\r\n");

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host: connection.host, port: connection.port });
    const commandId = 1;
    let isHandshakeComplete = false;
    let handshakeBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Inspector Runtime.evaluate timed out"));
    }, timeoutMs);

    const cleanup = (): void => {
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.end();
      socket.destroy();
    };

    socket.on("connect", () => {
      socket.write(request);
    });

    socket.on("error", (error) => {
      cleanup();
      reject(error);
    });

    socket.on("data", (chunk: Buffer) => {
      try {
        if (!isHandshakeComplete) {
          handshakeBuffer = Buffer.concat([handshakeBuffer, chunk]);
          const headerEndIndex = handshakeBuffer.indexOf("\r\n\r\n");

          if (headerEndIndex < 0) {
            return;
          }

          const headerText = handshakeBuffer.subarray(0, headerEndIndex).toString("utf8");

          if (!/^HTTP\/1\.1 101/i.test(headerText)) {
            throw new Error(`Inspector WebSocket upgrade failed: ${headerText.split("\r\n")[0]}`);
          }

          isHandshakeComplete = true;
          const rest = handshakeBuffer.subarray(headerEndIndex + 4);
          frameBuffer = rest.length ? Buffer.concat([frameBuffer, rest]) : frameBuffer;

          const payload = JSON.stringify({
            id: commandId,
            method: "Runtime.evaluate",
            params: {
              expression: options.expression,
              awaitPromise: false,
              returnByValue: true,
            },
          });
          socket.write(encodeWebSocketFrame(payload));
        } else {
          frameBuffer = Buffer.concat([frameBuffer, chunk]);
        }

        const decoded = decodeWebSocketFrames(frameBuffer);
        frameBuffer = Buffer.from(decoded.remaining);

        for (const message of decoded.messages) {
          const parsed = JSON.parse(message) as TInspectorProtocolMessage;

          if (parsed.id === commandId) {
            cleanup();

            if (parsed.error) {
              reject(new Error(`Inspector Runtime.evaluate failed: ${JSON.stringify(parsed.error)}`));
              return;
            }

            resolve();
            return;
          }
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  });
}


type TParsedHttpWatchEvent = {
  source: "APP" | "RTR";
  method?: string;
  url?: string;
  status?: string | number;
  durationMs?: number;
  requestId?: string;
  correlationId?: string;
  instance?: string;
  user?: string;
  tenant?: string;
  userAgent?: string;
  contentLength?: string;
  requestBytes?: string;
  responseBytes?: string;
  authorization?: string;
  message?: string;
};

function extractJsonFromCloudFoundryLogLine(line: string): Record<string, unknown> | undefined {
  const jsonStart = line.indexOf("{");

  if (jsonStart < 0) return undefined;

  try {
    return JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function parseHttpWatchAppLine(line: string): TParsedHttpWatchEvent | undefined {
  if (!line.includes("[APP/") || !line.includes("OUT")) return undefined;

  const payload = extractJsonFromCloudFoundryLogLine(line);
  if (!payload) return undefined;

  const msg = String(payload.msg ?? "");
  const methodMatch = msg.match(/\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([^\s{]+)/);

  if (!methodMatch) return undefined;

  return {
    source: "APP",
    method: methodMatch[1],
    url: methodMatch[2],
    requestId: String(payload.request_id ?? payload.x_vcap_request_id ?? payload.x_request_id ?? ""),
    correlationId: String(payload.correlation_id ?? payload.x_correlationid ?? payload.x_correlation_id ?? ""),
    instance: String(payload.x_cf_instanceindex ?? payload.component_instance ?? ""),
    user: String(payload.remote_user ?? ""),
    tenant: String(payload.tenant_subdomain ?? payload.tenantid ?? payload.tenant_id ?? ""),
    userAgent: String(payload.user_agent ?? ""),
    contentLength: String(payload.content_length ?? payload.request_size_b ?? ""),
    authorization: String(payload.authorization ?? ""),
    message: msg,
  };
}

function parseKeyValueFromRouterLine(line: string, key: string): string | undefined {
  const regex = new RegExp(`${key}:"([^"]*)"`);
  return line.match(regex)?.[1];
}

function parseHttpWatchRouterLine(line: string): TParsedHttpWatchEvent | undefined {
  if (!line.includes("[RTR/") || !line.includes("HTTP/")) return undefined;

  const requestMatch = line.match(/"(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([^\s]+)\s+HTTP\/[^"]+"\s+(\d{3})\s+(\d+)\s+(\d+)/);

  if (!requestMatch) return undefined;

  const responseTimeSeconds = Number(line.match(/response_time:([0-9.]+)/)?.[1] ?? "");

  return {
    source: "RTR",
    method: requestMatch[1],
    url: requestMatch[2],
    status: requestMatch[3],
    requestBytes: requestMatch[4],
    responseBytes: requestMatch[5],
    durationMs: Number.isFinite(responseTimeSeconds) ? Math.round(responseTimeSeconds * 1000) : undefined,
    requestId: parseKeyValueFromRouterLine(line, "vcap_request_id"),
    correlationId: parseKeyValueFromRouterLine(line, "x_correlationid"),
    instance: line.match(/app_index:"([^"]*)"/)?.[1],
    tenant: parseKeyValueFromRouterLine(line, "tenantid"),
    userAgent: line.match(/"\s+"([^"]*)"\s+"[^\"]+:\d+"/)?.[1],
  };
}

function parseHttpWatchLine(line: string): TParsedHttpWatchEvent | undefined {
  return parseHttpWatchAppLine(line) ?? parseHttpWatchRouterLine(line);
}

function formatHttpWatchEvent(appName: string, event: TParsedHttpWatchEvent): string {
  const status = event.status ? chalk.green(String(event.status)) : chalk.gray("APP");
  const duration = event.durationMs !== undefined ? chalk.gray(`${event.durationMs}ms`) : "";
  const source = event.source === "RTR" ? chalk.magenta("RTR") : chalk.blue("APP");
  const requestId = event.requestId ? chalk.gray(` req=${event.requestId}`) : "";
  const instance = event.instance ? chalk.gray(` i=${event.instance}`) : "";
  const user = event.user ? chalk.gray(` user=${event.user}`) : "";
  const tenant = event.tenant ? chalk.gray(` tenant=${event.tenant}`) : "";
  const size = event.contentLength || event.requestBytes ? chalk.gray(` bytes=${event.contentLength || event.requestBytes}`) : "";
  const auth = event.authorization ? chalk.gray(` auth=${event.authorization}`) : "";

  return `${source} ${chalk.cyan(`[${appName}]`)} ${status} ${chalk.bold(event.method ?? "")} ${event.url ?? ""} ${duration}${instance}${user}${tenant}${size}${auth}${requestId}`.trim();
}

function printHttpWatchLine(appName: string, line: string, outputFile?: string): void {
  const event = parseHttpWatchLine(line);

  if (!event) return;

  const formatted = formatHttpWatchEvent(appName, event);
  console.log(formatted);

  if (outputFile) {
    const plain = formatted.replace(/\u001b\[[0-9;]*m/g, "");
    fs.appendFileSync(outputFile, `${plain}\n`, "utf8");
  }
}

async function resolveHttpWatchApps(options: { app?: string; refresh?: boolean }): Promise<string[]> {
  if (options.app?.trim()) {
    return uniqueValues(options.app.split(","));
  }

  return resolveRequestTraceApps({ app: options.app, refresh: options.refresh });
}

async function runHttpWatchForApps(options: { appNames: string[]; recent?: boolean; out?: string }): Promise<void> {
  if (!options.appNames.length) throw new Error("No app selected for HTTP watch");

  if (options.out) {
    await fs.ensureDir(path.dirname(path.resolve(options.out)));
    await fs.writeFile(options.out, "", "utf8");
  }

  if (options.recent) {
    for (const appName of options.appNames) {
      const result = await runCommand("cf", ["logs", appName, "--recent"]);
      const text = `${result.stdout}\n${result.stderr}`;
      for (const line of text.split(/\r?\n/)) {
        printHttpWatchLine(appName, line, options.out);
      }
    }
    return;
  }

  const children: ChildProcess[] = [];
  const stopAll = (): void => {
    for (const child of children) {
      if (!child.killed) child.kill();
    }
  };

  process.once("SIGINT", () => {
    console.log(chalk.gray("\nStopping HTTP watch..."));
    stopAll();
    process.exit(0);
  });

  for (const appName of options.appNames) {
    const child = spawn("cf", ["logs", appName], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    children.push(child);

    child.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        printHttpWatchLine(appName, line, options.out);
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        printHttpWatchLine(appName, line, options.out);
      }
    });
  }

  console.log(chalk.green(`HTTP watch is watching ${options.appNames.length} app(s).`));
  console.log(chalk.gray("This uses existing CF/CDS/RTR logs. It shows method/path/status/user/tenant/size, but not full request body or full token."));
  console.log(chalk.gray("Press Ctrl+C to stop."));

  await new Promise<void>((resolve) => {
    let closedCount = 0;
    for (const child of children) {
      child.on("close", () => {
        closedCount += 1;
        if (closedCount >= children.length) resolve();
      });
    }
  });
}

async function runHttpWatchCommand(options: TCloudFoundryHttpWatchOptions): Promise<void> {
  if (!options.skipOrgSelect) {
    await maybeSwitchCloudFoundryTargetForDebug({ app: options.app, refresh: options.refresh, skipOrgSelect: false });
  }
  await ensureCloudFoundrySessionFromCache();

  const appNames = await resolveHttpWatchApps(options);
  await runHttpWatchForApps({ appNames, recent: options.recent, out: options.out });
}

async function runRequestTraceDoctorCommand(options: TCloudFoundryRequestTraceOptions): Promise<void> {
  await maybeSwitchCloudFoundryTargetForDebug({
    app: options.app,
    refresh: options.refresh,
    instance: options.instance,
    process: options.process,
    localPort: options.localPort,
    remotePort: options.remotePort,
    skipOrgSelect: options.skipOrgSelect,
  });
  await ensureCloudFoundrySessionFromCache();

  const appNames = await resolveRequestTraceApps({ app: options.app, refresh: options.refresh });
  const instanceIndex = await selectDebugInstance({ instance: options.instance });

  for (const appName of appNames) {
    console.log(chalk.cyan(`\nRequest trace doctor for ${appName} instance ${instanceIndex}`));
    console.log(chalk.gray("Recent router/app HTTP traffic:"));
    const result = await runCommand("cf", ["logs", appName, "--recent"]);
    const text = `${result.stdout}\n${result.stderr}`;
    let count = 0;
    for (const line of text.split(/\r?\n/)) {
      const event = parseHttpWatchLine(line);
      if (event) {
        count += 1;
        console.log(formatHttpWatchEvent(appName, event));
        if (count >= 10) break;
      }
    }
    if (!count) {
      console.log(chalk.yellow("No recent HTTP traffic found in CF logs for this app."));
    }

    console.log(chalk.gray("\nRemote process list:"));
    const processList = await runCommand("cf", ["ssh", appName, "-i", instanceIndex, "-T", "-c", "ps -eo pid,args 2>/dev/null | head -n 40"]);
    if (processList.stdout) console.log(processList.stdout);
    if (processList.stderr) console.error(processList.stderr);
  }

  console.log(chalk.yellow("\nDoctor summary:"));
  console.log("- If HTTP traffic appears above, the app is receiving requests.");
  console.log("- Full body/token are not available from CF/CDS logs because they are intentionally omitted or masked.");
  console.log("- Use smdg cf http-watch for stable live tracking.");
  console.log("- Use deep request-trace only when you accept Inspector/preload limitations in dev/test.");
}

function buildRequestTraceInjectionExpression(options: {
  appName: string;
  mode: TRequestTraceMode;
  authMode: TRequestTraceAuthMode;
  maxBodyBytes: number;
  parseBodyJson: boolean;
}): string {
  const traceOptions = JSON.stringify(options);
  const source = `(() => {
    const options = ${traceOptions};
    const globalKey = "__SMDG_NETWORK_SPY__";

    const state = globalThis[globalKey] || {
      installed: false,
      requestSeq: 0,
      options,
      patchedRequests: new WeakSet(),
      patchedResponses: new WeakSet(),
      patchedServers: new WeakSet(),
      activeRequests: new WeakMap(),
    };

    state.options = options;
    globalThis[globalKey] = state;

    function write(event) {
      try {
        console.log("SMDG_REQUEST_TRACE " + JSON.stringify(event));
      } catch (error) {
        console.log("SMDG_REQUEST_TRACE " + JSON.stringify({
          type: "smdg-request-trace-error",
          app: options.appName,
          message: error && error.message ? error.message : String(error),
        }));
      }
    }

    function currentOptions() {
      return globalThis[globalKey] && globalThis[globalKey].options ? globalThis[globalKey].options : options;
    }

    function shouldCaptureBody() {
      const mode = currentOptions().mode;
      return mode === "body" || mode === "response";
    }

    function shouldCaptureResponse() {
      return currentOptions().mode === "response";
    }

    function maxBodyBytes() {
      return Number(currentOptions().maxBodyBytes || 20000);
    }

    function maskAuthorization(value) {
      if (!value) return undefined;
      const authMode = currentOptions().authMode;
      if (authMode === "omit") return undefined;
      if (authMode === "full") return String(value);
      const text = String(value);
      return text.length <= 24 ? "***" : text.slice(0, 16) + "..." + text.slice(-8);
    }

    function normalizeHeaders(headers) {
      if (currentOptions().mode === "path") return undefined;
      const output = {};
      for (const [key, value] of Object.entries(headers || {})) {
        const lower = key.toLowerCase();
        if (lower === "authorization") {
          const auth = maskAuthorization(value);
          if (auth !== undefined) output[key] = auth;
          continue;
        }
        if (lower === "cookie" || lower === "set-cookie") {
          output[key] = "***";
          continue;
        }
        output[key] = value;
      }
      return output;
    }

    function appendChunk(record, chunk) {
      if (!chunk || !shouldCaptureBody()) return;
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        record.requestBytes += buffer.length;
        const currentBytes = record.requestChunks.reduce((sum, item) => sum + item.length, 0);
        const limit = maxBodyBytes();
        if (currentBytes < limit) {
          record.requestChunks.push(buffer.subarray(0, Math.max(0, limit - currentBytes)));
        }
      } catch {}
    }

    function appendResponseChunk(record, chunk) {
      if (!chunk || !shouldCaptureResponse()) return;
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        record.responseBytes += buffer.length;
        const currentBytes = record.responseChunks.reduce((sum, item) => sum + item.length, 0);
        const limit = maxBodyBytes();
        if (currentBytes < limit) {
          record.responseChunks.push(buffer.subarray(0, Math.max(0, limit - currentBytes)));
        }
      } catch {}
    }

    function chunksToText(chunks) {
      try {
        if (!chunks || !chunks.length) return undefined;
        return Buffer.concat(chunks).toString("utf8");
      } catch {
        return undefined;
      }
    }

    function tryParseContent(text, headers) {
      if (text === undefined) return undefined;
      if (!currentOptions().parseBodyJson) return text;
      const contentType = String((headers && (headers["content-type"] || headers["Content-Type"])) || "");
      if (contentType.includes("application/json") || /^[\\s]*[\\{\\[]/.test(text)) {
        try { return JSON.parse(text); } catch { return text; }
      }
      if (contentType.includes("application/x-www-form-urlencoded")) {
        try { return Object.fromEntries(new URLSearchParams(text)); } catch { return text; }
      }
      return text;
    }

    function getRequestUrl(req) {
      return req.originalUrl || req.url || req.path || "";
    }

    function patchRequestAndResponse(req, res, source) {
      if (!req || !res || state.patchedRequests.has(req)) return false;

      state.patchedRequests.add(req);
      const record = {
        id: ++state.requestSeq,
        source,
        startedAt: Date.now(),
        requestChunks: [],
        responseChunks: [],
        requestBytes: 0,
        responseBytes: 0,
      };
      state.activeRequests.set(req, record);

      try {
        if (!req.__SMDG_NETWORK_SPY_PUSH_PATCHED__) {
          const originalPush = req.push;
          if (typeof originalPush === "function") {
            req.push = function smdgNetworkTraceRequestPush(chunk, encoding) {
              appendChunk(record, chunk);
              return originalPush.call(this, chunk, encoding);
            };
            Object.defineProperty(req, "__SMDG_NETWORK_SPY_PUSH_PATCHED__", { value: true, enumerable: false });
          }
        }
      } catch {}

      try {
        const originalEmit = req.emit;
        if (typeof originalEmit === "function" && !req.__SMDG_NETWORK_SPY_EMIT_PATCHED__) {
          req.emit = function smdgNetworkTraceRequestEmit(eventName, chunk, ...args) {
            if (eventName === "data") appendChunk(record, chunk);
            return originalEmit.call(this, eventName, chunk, ...args);
          };
          Object.defineProperty(req, "__SMDG_NETWORK_SPY_EMIT_PATCHED__", { value: true, enumerable: false });
        }
      } catch {}

      try {
        if (!state.patchedResponses.has(res)) {
          state.patchedResponses.add(res);
          const originalWrite = res.write;
          const originalEnd = res.end;

          if (typeof originalWrite === "function") {
            res.write = function smdgNetworkTraceResponseWrite(chunk, ...args) {
              appendResponseChunk(record, chunk);
              return originalWrite.call(this, chunk, ...args);
            };
          }

          if (typeof originalEnd === "function") {
            res.end = function smdgNetworkTraceResponseEnd(chunk, ...args) {
              appendResponseChunk(record, chunk);
              return originalEnd.call(this, chunk, ...args);
            };
          }
        }
      } catch {}

      const finish = () => {
        try {
          const requestBodyText = chunksToText(record.requestChunks);
          const responseBodyText = chunksToText(record.responseChunks);
          const headers = req.headers || {};
          const event = {
            type: "smdg-request-trace",
            app: currentOptions().appName,
            source: record.source,
            id: record.id,
            timestamp: new Date(record.startedAt).toISOString(),
            method: req.method,
            url: getRequestUrl(req),
            status: res.statusCode,
            durationMs: Date.now() - record.startedAt,
            requestBytes: record.requestBytes,
            responseBytes: record.responseBytes,
            headers: normalizeHeaders(headers),
            body: shouldCaptureBody() ? tryParseContent(requestBodyText, headers) : undefined,
            responseBody: shouldCaptureResponse() ? tryParseContent(responseBodyText, res.getHeaders ? res.getHeaders() : {}) : undefined,
          };
          write(event);
        } catch (error) {
          write({
            type: "smdg-request-trace-error",
            app: currentOptions().appName,
            message: error && error.message ? error.message : String(error),
          });
        }
      };

      if (typeof res.once === "function") {
        res.once("finish", finish);
        res.once("close", () => {
          if (!res.writableEnded) finish();
        });
      }

      return true;
    }

    function installDiagnosticsChannelHook() {
      try {
        const diagnostics = require("diagnostics_channel");
        if (!diagnostics || diagnostics.__SMDG_NETWORK_SPY_PATCHED__) return false;
        const requestStart = diagnostics.channel("http.server.request.start");
        requestStart.subscribe((message) => {
          const req = message && (message.request || message.req);
          const res = message && (message.response || message.res);
          patchRequestAndResponse(req, res, "diagnostics_channel:http.server.request.start");
        });
        Object.defineProperty(diagnostics, "__SMDG_NETWORK_SPY_PATCHED__", { value: true, enumerable: false });
        return true;
      } catch {
        return false;
      }
    }

    function installServerEmitHook() {
      try {
        const http = require("http");
        const Server = http && http.Server;
        if (!Server || !Server.prototype || Server.prototype.__SMDG_NETWORK_SPY_EMIT_PATCHED__) return false;
        const originalEmit = Server.prototype.emit;
        Server.prototype.emit = function smdgNetworkTraceServerEmit(eventName, req, res, ...args) {
          if (eventName === "request") patchRequestAndResponse(req, res, "http.Server.emit");
          return originalEmit.call(this, eventName, req, res, ...args);
        };
        Object.defineProperty(Server.prototype, "__SMDG_NETWORK_SPY_EMIT_PATCHED__", { value: true, enumerable: false });
        return true;
      } catch {
        return false;
      }
    }

    function installCreateServerHook(moduleName) {
      try {
        const mod = require(moduleName);
        if (!mod || mod.__SMDG_NETWORK_SPY_CREATE_SERVER_PATCHED__) return false;
        const originalCreateServer = mod.createServer;
        if (typeof originalCreateServer !== "function") return false;
        mod.createServer = function smdgNetworkTraceCreateServer(...args) {
          const server = originalCreateServer.apply(this, args);
          hookServer(server, moduleName + ".createServer");
          return server;
        };
        Object.defineProperty(mod, "__SMDG_NETWORK_SPY_CREATE_SERVER_PATCHED__", { value: true, enumerable: false });
        return true;
      } catch {
        return false;
      }
    }

    function hookServer(server, source) {
      try {
        if (!server || state.patchedServers.has(server)) return false;
        if (typeof server.prependListener === "function") {
          server.prependListener("request", (req, res) => patchRequestAndResponse(req, res, source));
          state.patchedServers.add(server);
          return true;
        }
      } catch {}
      return false;
    }

    function hookActiveServers() {
      let count = 0;
      try {
        const handles = typeof process._getActiveHandles === "function" ? process._getActiveHandles() : [];
        for (const handle of handles) {
          if (handle && typeof handle.on === "function" && typeof handle.address === "function") {
            if (hookServer(handle, "active-handle")) count += 1;
          }
        }
      } catch {}
      return count;
    }

    const diagnosticsHooked = installDiagnosticsChannelHook();
    const serverEmitHooked = installServerEmitHook();
    const httpCreateHooked = installCreateServerHook("http");
    const httpsCreateHooked = installCreateServerHook("https");
    const activeServers = hookActiveServers();

    state.installed = true;
    state.installedAt = state.installedAt || new Date().toISOString();

    write({
      type: "smdg-request-trace-status",
      app: options.appName,
      status: "installed",
      engine: "network-trace-v4",
      diagnosticsHooked,
      serverEmitHooked,
      httpCreateHooked,
      httpsCreateHooked,
      activeServers,
      mode: options.mode,
      authMode: options.authMode,
      maxBodyBytes: options.maxBodyBytes,
    });

    return "installed:network-trace-v4:" + activeServers;
  })();`;

  return source;
}

async function selectRequestTraceMode(): Promise<TRequestTraceMode> {
  return searchableSelectChoice({
    message: "Select request trace mode",
    choices: [
      { title: "Path only", value: "path", description: "method, URL, status, duration" },
      { title: "Headers", value: "headers", description: "include request headers, mask sensitive values" },
      { title: "Headers + body", value: "body", description: "include request body up to a safe size limit" },
      { title: "Headers + body + response", value: "response", description: "include request body and response body" },
    ],
    allowCustomValue: false,
  }) as Promise<TRequestTraceMode>;
}

async function selectRequestTraceAuthMode(): Promise<TRequestTraceAuthMode> {
  return searchableSelectChoice({
    message: "Authorization header handling",
    choices: [
      { title: "Mask token (recommended)", value: "mask" },
      { title: "Show full token (dev/test only)", value: "full" },
      { title: "Omit Authorization header", value: "omit" },
    ],
    allowCustomValue: false,
  }) as Promise<TRequestTraceAuthMode>;
}

async function selectRequestTraceDisplayOptions(options: TCloudFoundryRequestTraceOptions): Promise<TRequestTraceDisplayOptions> {
  const headerPreset = await searchableSelectChoice({
    message: "Headers to display in terminal",
    choices: [
      { title: "Minimal headers", value: "minimal", description: "host, content-type, authorization, request/correlation ids" },
      { title: "Common debug headers", value: "common", description: "minimal + user-agent, origin, forwarded, CF/B3 headers" },
      { title: "All captured headers", value: "all", description: "large output" },
      { title: "Custom header list", value: "custom", description: "enter comma-separated headers" },
    ],
    allowCustomValue: false,
  }) as TRequestTraceHeaderPreset;

  let headerNames: string[] = [];
  if (headerPreset === "minimal") headerNames = getMinimalTraceHeaderNames();
  if (headerPreset === "common") headerNames = getCommonTraceHeaderNames();
  if (headerPreset === "custom") {
    const response = await prompts({
      type: "text",
      name: "headers",
      message: "Header names to display",
      initial: "authorization,content-type,content-length,x-correlationid,x-vcap-request-id,tenantid,user-agent",
      validate: (value: string) => value.trim() ? true : "At least one header is required",
    });
    headerNames = String(response.headers ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  }

  const parseResponse = await prompts({
    type: "select",
    name: "parseBodyJson",
    message: "Try parse request/response body as JSON when possible?",
    choices: [
      { title: "Yes, parse JSON/form body when possible", value: true },
      { title: "No, keep raw body string", value: false },
    ],
    initial: 0,
  });

  let outputFile = options.out;
  if (!outputFile) {
    const outResponse = await prompts({
      type: "select",
      name: "export",
      message: "Export captured trace events to JSONL file?",
      choices: [
        { title: "No", value: false },
        { title: "Yes", value: true },
      ],
      initial: 0,
    });

    if (outResponse.export) {
      const fileResponse = await prompts({
        type: "text",
        name: "file",
        message: "Trace output file",
        initial: `smdg-request-trace-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`,
        validate: (value: string) => value.trim() ? true : "Output file is required",
      });
      outputFile = String(fileResponse.file ?? "").trim();
    }
  }

  if (outputFile) {
    await fs.ensureDir(path.dirname(path.resolve(outputFile)));
    await fs.writeFile(outputFile, "", "utf8");
    console.log(chalk.green(`Trace events will be exported to ${path.resolve(outputFile)}`));
  }

  return {
    headerPreset,
    headerNames,
    parseBodyJson: Boolean(parseResponse.parseBodyJson),
    outputFile,
  };
}

async function resolveRequestTraceApps(options: TCloudFoundryRequestTraceOptions): Promise<string[]> {
  if (options.app?.trim()) {
    return uniqueValues(options.app.split(","));
  }

  const apps = await getAppsWithCache({ refresh: options.refresh, startBackgroundRefresh: !options.refresh });
  const selectedApps: string[] = [];

  while (true) {
    const appName = await searchableSelectChoice({
      message: selectedApps.length ? "Add another BTP app to trace, or finish" : "Search/select BTP app to trace",
      choices: [
        ...apps
          .filter((app) => !selectedApps.includes(app.name))
          .map((app) => ({
            title: [app.name, app.requestedState, app.routes].filter(Boolean).join(" | "),
            value: app.name,
          })),
        ...(selectedApps.length ? [{ title: "Done", value: "__DONE__" }] : []),
      ],
      validateCustomValue: validateRequired,
      customValueTitle: (value) => `Use typed app name: ${value}`,
    });

    if (appName === "__DONE__") {
      break;
    }

    selectedApps.push(appName);
    await rememberSelectedApp(appName);

    const moreResponse = await prompts({
      type: "select",
      name: "more",
      message: "Trace another app at the same time?",
      choices: [
        { title: "No, start tracing now", value: false },
        { title: "Yes, add another app", value: true },
      ],
      initial: 0,
    });

    if (!moreResponse.more) {
      break;
    }
  }

  return selectedApps;
}

function getMinimalTraceHeaderNames(): string[] {
  return [
    "host",
    "content-type",
    "content-length",
    "authorization",
    "x-correlation-id",
    "x-correlationid",
    "x-vcap-request-id",
    "tenantid",
  ];
}

function getCommonTraceHeaderNames(): string[] {
  return [
    ...getMinimalTraceHeaderNames(),
    "user-agent",
    "origin",
    "referer",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-path",
    "x-forwarded-proto",
    "x-cf-applicationid",
    "x-cf-instanceindex",
    "x-cf-true-client-ip",
    "x-b3-traceid",
    "x-b3-spanid",
    "b3",
  ];
}

function normalizeHeaderName(value: string): string {
  return value.trim().toLowerCase();
}

function filterTraceHeaders(headers: unknown, display: TRequestTraceDisplayOptions): Record<string, unknown> | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const source = headers as Record<string, unknown>;
  if (display.headerPreset === "all") return source;

  const names = new Set(display.headerNames.map(normalizeHeaderName));
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (names.has(normalizeHeaderName(key))) output[key] = value;
  }
  return output;
}

function stringifyTraceValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function traceEventMatchesFilters(event: Record<string, unknown>, filters: TRequestTraceFilterState): boolean {
  if (filters.paused) return false;
  const method = String(event.method ?? "").toLowerCase();
  const url = String(event.url ?? "").toLowerCase();
  const status = String(event.status ?? "").toLowerCase();
  const body = stringifyTraceValue(event.body).toLowerCase();
  const responseBody = stringifyTraceValue(event.responseBody).toLowerCase();
  const all = stringifyTraceValue(event).toLowerCase();

  if (filters.method && method !== filters.method.toLowerCase()) return false;
  if (filters.path && !url.includes(filters.path.toLowerCase())) return false;
  if (filters.status && !status.includes(filters.status.toLowerCase())) return false;
  if (filters.body && !body.includes(filters.body.toLowerCase()) && !responseBody.includes(filters.body.toLowerCase())) return false;
  if (filters.text && !all.includes(filters.text.toLowerCase())) return false;
  return true;
}

function buildPrintableTracePayload(event: Record<string, unknown>, display: TRequestTraceDisplayOptions): Record<string, unknown> {
  const output: Record<string, unknown> = {
    type: event.type,
    app: event.app,
    source: event.source,
    id: event.id,
    timestamp: event.timestamp,
    method: event.method,
    url: event.url,
    status: event.status,
    durationMs: event.durationMs,
    requestBytes: event.requestBytes,
    responseBytes: event.responseBytes,
  };

  const headers = filterTraceHeaders(event.headers, display);
  if (headers && Object.keys(headers).length > 0) output.headers = headers;
  if (event.body !== undefined) output.body = event.body;
  if (event.responseBody !== undefined) output.responseBody = event.responseBody;
  return output;
}

function writeTraceEventToFile(outputFile: string | undefined, event: Record<string, unknown>): void {
  if (!outputFile) return;
  try {
    fs.appendFileSync(outputFile, `${JSON.stringify(event)}\n`, "utf8");
  } catch (error) {
    console.error(chalk.yellow(`Failed to write trace event to file: ${error instanceof Error ? error.message : String(error)}`));
  }
}

function printRequestTraceEvent(appName: string, payload: Record<string, unknown>, runtime: TRequestTraceRuntimeState): void {
  const type = String(payload.type ?? "smdg-request-trace");

  if (type === "smdg-request-trace-status") {
    console.log(chalk.green(`[${appName}] ${String(payload.status ?? "trace-status")}`));
    console.log(chalk.gray(`engine=${String(payload.engine ?? "unknown")} activeServers=${String(payload.activeServers ?? "?")} mode=${String(payload.mode ?? "")}`));
    return;
  }

  if (type === "smdg-request-trace-error") {
    console.log(chalk.red(`[${appName}] trace error: ${String(payload.message ?? "unknown")}`));
    return;
  }

  runtime.events.push(payload);
  writeTraceEventToFile(runtime.display.outputFile, payload);

  if (!traceEventMatchesFilters(payload, runtime.filters)) return;

  const time = String(payload.timestamp ?? new Date().toISOString());
  const method = String(payload.method ?? "");
  const url = String(payload.url ?? "");
  const status = String(payload.status ?? "");
  const duration = String(payload.durationMs ?? "");
  console.log(chalk.cyan(`\n[${time}] [${appName}] ${method} ${url} → ${status} ${duration}ms`));
  console.log(JSON.stringify(buildPrintableTracePayload(payload, runtime.display), null, 2));
}

function printRequestTraceLine(appName: string, line: string, runtime: TRequestTraceRuntimeState): void {
  const marker = line.includes("SMDG_REQUEST_TRACE ") ? "SMDG_REQUEST_TRACE " : line.includes("SMDG_REQUEST_SPY ") ? "SMDG_REQUEST_SPY " : undefined;
  if (!marker) return;

  const markerIndex = line.indexOf(marker);
  const payloadText = line.slice(markerIndex + marker.length).trim();

  try {
    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    printRequestTraceEvent(appName, payload, runtime);
  } catch {
    console.log(`[${appName}] ${payloadText}`);
  }
}

function printTraceRuntimeHelp(): void {
  console.log(chalk.gray("\nRuntime trace commands:"));
  console.log(chalk.gray("  /method POST        show only one method"));
  console.log(chalk.gray("  /path text          show only URLs containing text"));
  console.log(chalk.gray("  /body text          show only request/response body containing text"));
  console.log(chalk.gray("  /status 500         show only status containing value"));
  console.log(chalk.gray("  /text value         search anywhere in the event"));
  console.log(chalk.gray("  /headers a,b,c      change displayed headers while running"));
  console.log(chalk.gray("  /headers all        display all captured headers"));
  console.log(chalk.gray("  /clear              clear active filters"));
  console.log(chalk.gray("  /show               show active filters"));
  console.log(chalk.gray("  /replay             print matching events already captured"));
  console.log(chalk.gray("  /pause or /resume   pause/resume terminal display"));
  console.log(chalk.gray("  /help               show this help"));
}

function applyTraceRuntimeCommand(input: string, runtime: TRequestTraceRuntimeState): void {
  const trimmed = input.trim();
  if (!trimmed) return;
  if (!trimmed.startsWith("/")) {
    runtime.filters.text = trimmed;
    console.log(chalk.yellow(`Search text filter: ${trimmed}`));
    return;
  }

  const [commandRaw, ...restParts] = trimmed.slice(1).split(" ");
  const command = commandRaw.toLowerCase();
  const value = restParts.join(" ").trim();

  if (command === "method") runtime.filters.method = value || undefined;
  else if (command === "path") runtime.filters.path = value || undefined;
  else if (command === "body") runtime.filters.body = value || undefined;
  else if (command === "status") runtime.filters.status = value || undefined;
  else if (command === "text") runtime.filters.text = value || undefined;
  else if (command === "pause") runtime.filters.paused = true;
  else if (command === "resume") runtime.filters.paused = false;
  else if (command === "clear") {
    runtime.filters.method = undefined;
    runtime.filters.path = undefined;
    runtime.filters.body = undefined;
    runtime.filters.status = undefined;
    runtime.filters.text = undefined;
    runtime.filters.paused = false;
  } else if (command === "headers") {
    if (!value || value.toLowerCase() === "common") {
      runtime.display.headerPreset = "common";
      runtime.display.headerNames = getCommonTraceHeaderNames();
    } else if (value.toLowerCase() === "minimal") {
      runtime.display.headerPreset = "minimal";
      runtime.display.headerNames = getMinimalTraceHeaderNames();
    } else if (value.toLowerCase() === "all") {
      runtime.display.headerPreset = "all";
      runtime.display.headerNames = [];
    } else {
      runtime.display.headerPreset = "custom";
      runtime.display.headerNames = value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  } else if (command === "show") {
    console.log(chalk.gray(JSON.stringify({ filters: runtime.filters, display: runtime.display, captured: runtime.events.length }, null, 2)));
    return;
  } else if (command === "replay") {
    console.log(chalk.gray(`Replaying ${runtime.events.length} captured event(s) with current filters...`));
    for (const event of runtime.events) {
      if (traceEventMatchesFilters(event, runtime.filters)) {
        const appName = String(event.app ?? "app");
        const time = String(event.timestamp ?? "");
        console.log(chalk.cyan(`\n[${time}] [${appName}] ${String(event.method ?? "")} ${String(event.url ?? "")} → ${String(event.status ?? "")} ${String(event.durationMs ?? "")}ms`));
        console.log(JSON.stringify(buildPrintableTracePayload(event, runtime.display), null, 2));
      }
    }
    return;
  } else if (command === "help" || command === "?") {
    printTraceRuntimeHelp();
    return;
  } else {
    console.log(chalk.yellow(`Unknown runtime command: ${command}`));
    printTraceRuntimeHelp();
    return;
  }

  console.log(chalk.yellow(`Trace runtime updated: ${trimmed}`));
}

function attachTraceRuntimeCommands(runtime: TRequestTraceRuntimeState): void {
  printTraceRuntimeHelp();
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (chunk: string) => {
    for (const line of chunk.split(/\r?\n/)) {
      applyTraceRuntimeCommand(line, runtime);
    }
  });
}

function startRequestTraceLogStream(appName: string, runtime: TRequestTraceRuntimeState): ChildProcess {
  const childProcess = spawn("cf", ["logs", appName], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  childProcess.stdout.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/);
    for (const line of lines) printRequestTraceLine(appName, line, runtime);
  });

  childProcess.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    if (/SMDG_REQUEST_(TRACE|SPY)/.test(text)) {
      for (const line of text.split(/\r?\n/)) printRequestTraceLine(appName, line, runtime);
    }
  });

  return childProcess;
}

async function runRequestTraceCommand(options: TCloudFoundryRequestTraceOptions): Promise<void> {
  await maybeSwitchCloudFoundryTargetForDebug({
    app: options.app,
    refresh: options.refresh,
    instance: options.instance,
    process: options.process,
    localPort: options.localPort,
    remotePort: options.remotePort,
    skipOrgSelect: options.skipOrgSelect,
  });
  await ensureCloudFoundrySessionFromCache();

  const appNames = await resolveRequestTraceApps(options);

  if (!appNames.length) {
    throw new Error("No app selected for request trace");
  }

  const engine = await searchableSelectChoice({
    message: "Select request trace engine",
    choices: [
      {
        title: "HTTP watch from existing CF/CDS logs (recommended, stable)",
        value: "http-watch",
        description: "Shows method/path/status/user/tenant/size. No restart and no source-code change.",
      },
      {
        title: "Deep Node Inspector trace (experimental body capture)",
        value: "inspector-trace",
        description: "Attempts runtime injection. May not work for every CAP runtime. Dev/test only.",
      },
      {
        title: "Doctor: verify traffic, process, and limits",
        value: "doctor",
      },
    ],
    allowCustomValue: false,
  });

  if (engine === "http-watch") {
    await runHttpWatchForApps({ appNames, recent: false, out: undefined });
    return;
  }

  if (engine === "doctor") {
    await runRequestTraceDoctorCommand({ ...options, app: appNames.join(",") });
    return;
  }

  const traceMode = await selectRequestTraceMode();
  const authMode = await selectRequestTraceAuthMode();
  const displayOptions = await selectRequestTraceDisplayOptions(options);
  const runtime: TRequestTraceRuntimeState = {
    display: displayOptions,
    filters: { paused: false },
    events: [],
  };
  const instanceIndex = await selectDebugInstance({ instance: options.instance });
  const baseLocalPort = await selectDebugPort({
    value: options.localPort,
    message: "Select first local inspector port for request trace",
    defaultPort: 9329,
  });
  const remotePort = parsePositivePort(options.remotePort, 9229);
  const maxBodyBytes = parsePositivePort(options.maxBodyBytes, 20000);

  console.log("");
  console.log(chalk.yellow("Request trace attaches to the running Node.js app through Node Inspector."));
  console.log(chalk.gray("It does not modify your repository source code. It is temporary and disappears after app restart."));
  const prepareMode = await selectNodeInspectorPrepareMode({ appName: appNames.join(", "), remotePort });

  const tunnelProcesses: ChildProcess[] = [];
  const logProcesses: ChildProcess[] = [];

  const stopAll = (): void => {
    for (const child of [...tunnelProcesses, ...logProcesses]) {
      if (!child.killed) child.kill();
    }
  };

  process.once("SIGINT", () => {
    console.log(chalk.gray("\nStopping request trace..."));
    stopAll();
    process.exit(0);
  });

  for (const [index, appName] of appNames.entries()) {
    const localPort = baseLocalPort + index;
    await ensureSshEnabledForDebug(appName);

    if (prepareMode === "set-env-restart") {
      await setNodeInspectorEnvironmentAndRestart({ appName, remotePort });
    }

    console.log(chalk.gray(`Opening inspector tunnel for ${appName}: localhost:${localPort} -> 127.0.0.1:${remotePort}`));
    const tunnelProcess = spawn("cf", buildCloudFoundryDebugSshArgs({
      appName,
      instanceIndex,
      processName: options.process,
      localPort,
      remotePort,
      prepareMode,
    }), {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });
    tunnelProcesses.push(tunnelProcess);

    tunnelProcess.stdout.on("data", (chunk: Buffer) => process.stdout.write(chalk.gray(`[${appName}:ssh] ${chunk.toString("utf8")}`)));
    tunnelProcess.stderr.on("data", (chunk: Buffer) => process.stderr.write(chalk.yellow(`[${appName}:ssh] ${chunk.toString("utf8")}`)));

    const webSocketUrl = await waitForNodeInspectorWebSocketUrl(localPort, 20000);

    if (!webSocketUrl) {
      console.log(chalk.red(`Cannot reach Node Inspector for ${appName} on localhost:${localPort}.`));
      console.log(chalk.yellow("Try again and choose: Set NODE_OPTIONS and restart app."));
      continue;
    }

    const expression = buildRequestTraceInjectionExpression({
      appName,
      mode: traceMode,
      authMode,
      maxBodyBytes,
      parseBodyJson: displayOptions.parseBodyJson,
    });

    await sendInspectorEvaluateCommand({ webSocketUrl, expression });
    console.log(chalk.green(`Request trace injected into ${appName}.`));

    const logProcess = startRequestTraceLogStream(appName, runtime);
    logProcesses.push(logProcess);
  }

  console.log("");
  console.log(chalk.green(`Request trace is watching ${appNames.length} app(s).`));
  console.log(chalk.gray("Send requests to your services. Type /help for runtime search commands. Press Ctrl+C to stop tunnels and log streams."));
  attachTraceRuntimeCommands(runtime);

  await new Promise<void>((resolve) => {
    const watchedProcesses = [...tunnelProcesses, ...logProcesses];
    let closedCount = 0;
    for (const child of watchedProcesses) {
      child.on("close", () => {
        closedCount += 1;
        if (closedCount >= watchedProcesses.length) resolve();
      });
    }
  });
}

async function runDebugCommand(options: TCloudFoundryDebugOptions): Promise<void> {
  await maybeSwitchCloudFoundryTargetForDebug(options);
  await ensureCloudFoundrySessionFromCache();

  const appName = await resolveAppSelection({
    app: options.app,
    refresh: options.refresh,
    message: "Search/select BTP app to debug",
  });
  const debugMode = await selectDebugMode(options);
  const instanceIndex = await selectDebugInstance(options);
  const localPort = await selectDebugPort({
    value: options.localPort,
    message: "Select local debug port",
    defaultPort: 9229,
  });
  const remotePort = parsePositivePort(options.remotePort, 9229);
  const repositoryPath = await resolveRepositoryPath(process.cwd()).catch(() => process.cwd());

  if (debugMode === "check-ssh") {
    const result = await runCommand("cf", ["ssh-enabled", appName]);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);
    process.exitCode = result.exitCode;
    return;
  }

  if (debugMode === "enable-ssh") {
    const result = await runCommand("cf", ["enable-ssh", appName]);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);

    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
      return;
    }

    const restartResponse = await prompts({
      type: "select",
      name: "restart",
      message: "Restart app now so SSH setting takes effect?",
      choices: [
        { title: "Yes, restart app", value: true },
        { title: "No, I will restart later", value: false },
      ],
      initial: 0,
    });

    if (restartResponse.restart) {
      const restartExitCode = await runCommandInherit("cf", ["restart", appName]);
      process.exitCode = restartExitCode;
      return;
    }

    console.log(chalk.yellow(`SSH was enabled. Restart the app before debugging: cf restart ${appName}`));
    return;
  }

  let launchJsonPath: string | undefined;

  if (debugMode === "vscode" || debugMode === "config-only") {
    launchJsonPath = await writeVscodeLaunchConfiguration({
      cwd: repositoryPath,
      appName,
      localPort,
      remoteRoot: "/home/vcap/app",
    });
    console.log(chalk.green(`Updated VS Code launch config: ${launchJsonPath}`));

    const openResponse = await prompts({
      type: "select",
      name: "open",
      message: "Open current folder in VS Code?",
      choices: [
        { title: "No", value: false },
        { title: "Yes", value: true },
      ],
      initial: options.open ? 1 : 0,
    });

    if (openResponse.open) {
      await openVisualStudioCode({ cwd: repositoryPath, debugPanel: debugMode === "vscode" });
    }
  }

  if (debugMode === "config-only") {
    printVscodeAttachInstructions({
      appName,
      instanceIndex,
      localPort,
      launchJsonPath: launchJsonPath ?? path.resolve(repositoryPath, ".vscode", "launch.json"),
    });
    return;
  }

  if (debugMode === "link-only") {
    const debugUrl = await waitForNodeInspectorDebugUrl(localPort, 2000);
    printNodeInspectorAttachInfo({ appName, instanceIndex, localPort, debugUrl });
    return;
  }

  if (options.enableSsh) {
    const result = await runCommand("cf", ["enable-ssh", appName]);
    if (result.stdout) console.log(result.stdout);
    if (result.stderr) console.error(result.stderr);

    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
      return;
    }

    if (options.restart) {
      const restartExitCode = await runCommandInherit("cf", ["restart", appName]);

      if (restartExitCode !== 0) {
        process.exitCode = restartExitCode;
        return;
      }
    } else {
      console.log(chalk.yellow("SSH was enabled. If cf ssh still fails, restart the app or run: cf restart " + appName));
    }
  }

  console.log("");
  console.log(chalk.cyan("BTP debug works by opening a CF SSH tunnel to the Node.js inspector."));
  console.log(chalk.gray("If this is the first time debugging this app, choose: Set NODE_OPTIONS and restart app."));
  console.log(chalk.gray("If the app was already restarted with NODE_OPTIONS=--inspect, choose: Inspector is already enabled."));
  const prepareMode = await selectNodeInspectorPrepareMode({ appName, remotePort });

  await ensureSshEnabledForDebug(appName);

  if (prepareMode === "set-env-restart") {
    await setNodeInspectorEnvironmentAndRestart({ appName, remotePort });
  }

  console.log(chalk.gray(`Starting Node.js inspector tunnel for ${appName} instance ${instanceIndex}...`));
  console.log(chalk.gray(`Forwarding localhost:${localPort} -> app container 127.0.0.1:${remotePort}`));

  const childProcess = spawn("cf", buildCloudFoundryDebugSshArgs({
    appName,
    instanceIndex,
    processName: options.process,
    localPort,
    remotePort,
    prepareMode,
  }), {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });

  let hasPrintedAttachInfo = false;

  const printAttachInfoOnce = async (): Promise<void> => {
    if (hasPrintedAttachInfo) {
      return;
    }

    hasPrintedAttachInfo = true;

    const debugUrl = await waitForNodeInspectorDebugUrl(localPort);

    if (debugMode === "vscode") {
      if (!debugUrl) {
        console.log(chalk.yellow("Inspector is not reachable yet on localhost. If you selected running-process mode and see a Node PID error, run debug again and choose 'Set NODE_OPTIONS and restart app'."));
      }

      printVscodeAttachInstructions({
        appName,
        instanceIndex,
        localPort,
        launchJsonPath: launchJsonPath ?? path.resolve(repositoryPath, ".vscode", "launch.json"),
        inspectorReady: Boolean(debugUrl),
      });
      return;
    }

    printNodeInspectorAttachInfo({ appName, instanceIndex, localPort, debugUrl });
  };

  childProcess.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    process.stdout.write(text);

    if (/inspector|debug|listening|started/i.test(text)) {
      void printAttachInfoOnce();
    }
  });

  childProcess.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk.toString("utf8"));
  });

  const fallbackTimer = setTimeout(() => {
    void printAttachInfoOnce();
  }, 3000);

  childProcess.on("close", (exitCode) => {
    clearTimeout(fallbackTimer);

    if (!hasPrintedAttachInfo || (exitCode ?? 0) !== 0) {
      console.log("");
      console.log(chalk.red("Debug tunnel stopped before a working inspector connection was confirmed."));
      console.log(chalk.yellow("Run smdg cf debug again and choose 'Set NODE_OPTIONS and restart app' when asked to prepare Node.js inspector."));
      console.log(chalk.gray("After the app restarts, choose VS Code guided debugging and start the attach config from VS Code Run and Debug."));
    }

    process.exitCode = exitCode ?? 0;
  });

  // Same reasoning as cf logs above: this tunnel's stdio isn't inherited, so
  // without an explicit SIGINT handler here, Ctrl+C killed `smdg` (Node's
  // default disposition) but left the `cf ssh` tunnel child running.
  process.once("SIGINT", () => {
    console.log(chalk.gray("\nStopping debug tunnel..."));
    clearTimeout(fallbackTimer);
    if (!childProcess.killed) childProcess.kill();
    process.exit(0);
  });

  await new Promise<void>((resolve) => {
    childProcess.on("close", () => resolve());
  });
}

async function runTargetCommand(): Promise<void> {
  const target = await readCloudFoundryTarget();
  printTarget(target);
}

async function runCacheCommand(): Promise<void> {
  const cache = await readCache();
  console.log(JSON.stringify(cache.cloudFoundry, null, 2));
}

/* ====================================================================
   CF REGION REGISTRY COMMANDS
   ==================================================================== */
function printRegionList(regions: TCfRegionEndpoint[], ctx: TInteractionContext = getDefaultInteractionContext()): void {
  const lines: string[] = [chalk.bold("SimpleMDG CF Regions"), ""];
  for (const region of regions) {
    const box = region.enabled ? chalk.green("[x]") : chalk.gray("[ ]");
    const name = (region.enabled ? chalk.white : chalk.gray)(region.region.padEnd(8));
    const custom = region.isCustom ? chalk.cyan(" (custom)") : "";
    const label = region.label ? chalk.gray(` ${region.label}`) : "";
    lines.push(`${box} ${name} ${chalk.gray(region.apiEndpoint)}${custom}${label}`);
  }
  ctx.interaction.notify({ level: "info", message: lines.join("\n") });
}

async function runRegionListCommand(): Promise<void> {
  printRegionList(await listRegions());
}

async function runRegionAddCommand(options: { api?: string; region?: string; label?: string }, ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  let apiEndpoint = options.api?.trim();

  if (!apiEndpoint) {
    apiEndpoint = (await ctx.interaction.input({
      message: "Custom CF API endpoint (e.g. https://api.cf.eu30.hana.ondemand.com)",
      validate: (value: string) => (value.trim() ? true : "API endpoint is required"),
    })).trim();
  }

  if (!apiEndpoint) {
    ctx.interaction.notify({ level: "warn", message: "No API endpoint provided. Aborted." });
    return;
  }

  const added = await addCustomRegion({ apiEndpoint, region: options.region, label: options.label });
  ctx.interaction.notify({ level: "success", message: `Added custom region ${added.region} (${added.apiEndpoint}).` });
}

async function runRegionTestCommand(options: { region?: string }, ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  const regions = await listRegions();
  const targets = options.region
    ? regions.filter((region) => region.region === options.region!.toLowerCase())
    : await listEnabledRegions();

  if (!targets.length) {
    ctx.interaction.notify({ level: "warn", message: "No matching regions to test." });
    return;
  }

  const originalTarget = await readCloudFoundryTarget();

  return ctx.interaction.progress({ label: "Testing region endpoints" }, async (report) => {
    for (let index = 0; index < targets.length; index += 1) {
      const region = targets[index];
      report({ current: index + 1, total: targets.length, label: `Testing ${region.region}` });
      const result = await runCommand("cf", ["api", region.apiEndpoint]);
      ctx.interaction.notify({
        level: result.exitCode === 0 ? "success" : "error",
        message: `${region.region.padEnd(8)} ${result.exitCode === 0 ? "reachable" : "unreachable"}`,
      });
    }

    if (originalTarget.apiEndpoint) {
      await runCommand("cf", ["api", originalTarget.apiEndpoint]);
    }
  });
}

async function runRegionRefreshCommand(options: { region?: string }, ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  await ensureExternalTool("cf");
  ctx.interaction.notify({ level: "muted", message: "Refreshing CF targets across enabled regions..." });
  const cache = await readCache();
  const credentials = cache.cloudFoundry.loginProfiles.map((profile) => ({
    apiEndpoint: profile.apiEndpoint,
    username: profile.username,
    password: profile.password,
  }));
  const enabled = await listEnabledRegions();
  const regions = options.region
    ? enabled.filter((region) => region.region === options.region || region.apiEndpoint === options.region)
    : enabled;
  const summary = await scanCrossRegionTargets({ credentials, regions });
  const lines = summary.regionResults.map((region) => {
    const tag = region.status === "success" ? chalk.green("success") : chalk.red("failed");
    const suffix = region.status === "failed" && region.usedCache ? chalk.gray(" · using cached result") : "";
    return `  ${region.region.padEnd(8)} ${tag} · ${region.targetCount} targets${suffix}`;
  });
  ctx.interaction.notify({ level: "info", message: lines.join("\n") });
  ctx.interaction.notify({ level: "success", message: `Region targets refreshed · ${summary.totalTargets} total.` });
}

async function runRegionInteractiveCommand(ctx: TInteractionContext = getDefaultInteractionContext()): Promise<void> {
  const regions = await listRegions();
  printRegionList(regions, ctx);

  const action = await ctx.interaction.select({
    message: "Region actions",
    choices: [
      { title: "Enable / disable regions", value: "toggle" },
      { title: "Add custom region", value: "add" },
      { title: "Remove custom region", value: "remove" },
      { title: "Test region endpoints", value: "test" },
      { title: "Refresh targets for all enabled regions", value: "refresh" },
      { title: "Exit", value: "__exit__" },
    ],
    allowCustomValue: false,
  });

  if (action === "toggle") {
    const enabledRegionNames = await ctx.interaction.multiSelect({
      message: "Select regions to enable",
      choices: regions.map((region) => ({
        title: `${region.region} — ${region.apiEndpoint}`,
        value: region.region,
        selected: region.enabled,
      })),
      hint: "Space to toggle, Enter to confirm",
    });
    const enabledSet = new Set(enabledRegionNames);
    for (const region of regions) {
      await setRegionEnabled(region.region, enabledSet.has(region.region));
    }
    ctx.interaction.notify({ level: "success", message: `Enabled ${enabledSet.size} region(s).` });
    return;
  }

  if (action === "add") {
    await runRegionAddCommand({}, ctx);
    return;
  }

  if (action === "remove") {
    const custom = regions.filter((region) => region.isCustom);
    if (!custom.length) {
      ctx.interaction.notify({ level: "muted", message: "No custom regions to remove." });
      return;
    }
    const selected = await ctx.interaction.select({
      message: "Remove custom region",
      choices: [
        ...custom.map((region) => ({ title: `${region.region} — ${region.apiEndpoint}`, value: region.region })),
        { title: "Cancel", value: "__cancel__" },
      ],
      allowCustomValue: false,
    });
    if (selected !== "__cancel__") {
      await removeRegion(selected);
      ctx.interaction.notify({ level: "success", message: `Removed region ${selected}.` });
    }
    return;
  }

  if (action === "test") {
    await runRegionTestCommand({}, ctx);
    return;
  }

  if (action === "refresh") {
    await runRegionRefreshCommand({}, ctx);
  }
}

export function registerCloudFoundryCommands(program: Command): void {
  const cfCommand = program.command("cf").description("Cloud Foundry helper commands for SimpleMDG");

  cfCommand
    .command("login")
    .description("Login to Cloud Foundry and cache login profile")
    .option("--api <apiEndpoint>", "CF API endpoint")
    .option("--username <username>", "CF username")
    .option("--password <password>", "CF password")
    .option("--org <org>", "CF org")
    .option("--space <space>", "CF space")
    .option("--save-password", "Cache password in ~/.simplemdg/cache.json. Avoid on shared machines.")
    .action(runLoginCommand);

  cfCommand.command("target").description("Show current cf target").action(runTargetCommand);

  const regionCommand = cfCommand
    .command("region")
    .description("Manage CF region endpoints used by the cross-region target scanner")
    // Commander always appends the Command instance as a trailing arg to
    // .action() callbacks — calling with just `options` (dropping that extra
    // arg) is required so runRegionInteractiveCommand's own optional `ctx`
    // parameter correctly falls back to its default instead of receiving the
    // Command instance in place of a TInteractionContext.
    .action(() => runRegionInteractiveCommand());
  regionCommand.command("list").description("List configured CF regions").action(runRegionListCommand);
  regionCommand
    .command("add")
    .description("Add a custom CF region endpoint")
    .option("--api <apiEndpoint>", "CF API endpoint URL")
    .option("--region <region>", "Region name (derived from endpoint when omitted)")
    .option("--label <label>", "Optional friendly label")
    .action((options) => runRegionAddCommand(options));
  regionCommand
    .command("test")
    .description("Test reachability of region endpoints")
    .option("--region <region>", "Test only one region")
    .action((options) => runRegionTestCommand(options));
  regionCommand
    .command("refresh")
    .description("Refresh cross-region targets for enabled regions")
    .option("--region <apiEndpoint>", "Limit refresh to one API endpoint")
    .action((options) => runRegionRefreshCommand(options));

  cfCommand
    .command("org")
    .description("List orgs or switch to another org/space without logging in again")
    .option("--list", "List orgs across known CF regions")
    .option("--switch", "Switch to another org and space across known CF regions")
    .option("--refresh", "Search orgs from CF region endpoints and update cache")
    .option("--api <apiEndpoint>", "Limit org search/switch to one CF API endpoint")
    .option("--org <org>", "CF org name")
    .option("--space <space>", "CF space name")
    // See the `region` registration above for why this can't be `.action(runOrgCommand)` directly.
    .action((options) => runOrgCommand(options));

  cfCommand
    .command("apps")
    .description("List BTP apps in current org and space with per-target cache")
    .option("--refresh", "Wait for fresh app list from cf apps and update cache")
    .option("--select", "Select one app and print its name")
    .action(runAppsCommand);

  cfCommand
    .command("bind")
    .description("Run cds bind --to-app-services <app>")
    .option("--app <appName>", "BTP app name")
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--refresh", "Refresh app list before selecting")
    .option("--target", "Pick a target across regions first (favorites/recent/all)")
    .action(runBindCommand);

  cfCommand
    .command("env")
    .description("Export cf env <app> to clean JSON file")
    .option("--app <appName>", "BTP app name")
    .option("--out <fileName>", "Output file name", undefined)
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--refresh", "Refresh app list before selecting")
    .option("--raw", "Export raw cf env output instead of clean JSON")
    .option("--target", "Pick a target across regions first (favorites/recent/all)")
    .action(runEnvCommand);


  cfCommand
    .command("logs")
    .description("View realtime or recent logs for a BTP app")
    .option("--app <appName>", "BTP app name")
    .option("--refresh", "Refresh app list before selecting")
    .option("--recent", "Show recent logs and exit")
    .option("--follow", "Follow realtime logs. This is the default when --recent is not used")
    .option("--out <fileName>", "Export logs to file. With realtime logs, append until Ctrl+C")
    .option("--instance <index>", "Filter logs by app instance index, for example 0 or 1")
    .option("--process <processName>", "Filter logs by process name, for example WEB")
    .option("--target", "Pick a target across regions first (favorites/recent/all)")
    .action(runLogsCommand);


  cfCommand
    .command("ssh")
    .description("Open an interactive SSH session into a BTP Cloud Foundry app instance (cf ssh)")
    .option("--app <appName>", "BTP app name")
    .option("--refresh", "Refresh app list before selecting")
    .option("--instance <index>", "App instance index", "0")
    .option("--target", "Pick a target across regions first (favorites/recent/all)")
    .action(runSshCommand);

  cfCommand
    .command("debug")
    .description("Debug a deployed BTP Cloud Foundry Node.js app with selectable VS Code or Chrome mode")
    .option("--app <appName>", "BTP app name")
    .option("--refresh", "Refresh app list before selecting")
    .option("--instance <index>", "App instance index", "0")
    .option("--process <processName>", "CF process name for multi-process apps")
    .option("--local-port <port>", "Local inspector port", "9229")
    .option("--remote-port <port>", "Remote inspector port in app container", "9229")
    .option("--enable-ssh", "Run cf enable-ssh <app> before opening the debug tunnel")
    .option("--restart", "Restart app after --enable-ssh")
    .option("--check", "Run cf ssh-enabled <app> and exit")
    .option("--link-only", "Only print attach links/config for an already-open tunnel")
    .option("--vscode", "Use VS Code attach debug mode")
    .option("--chrome", "Use Chrome DevTools debug mode")
    .option("--config-only", "Only create/update .vscode/launch.json")
    .option("--open", "Open current folder in VS Code after creating launch.json")
    .option("--skip-org-select", "Use current CF org/space without asking")
    .action(runDebugCommand);


  cfCommand
    .command("http-watch")
    .alias("watch-http")
    .description("Watch incoming HTTP requests using existing CF/CDS/RTR logs. Stable and does not modify apps.")
    .option("--app <appName>", "BTP app name. Use comma-separated names to watch multiple apps")
    .option("--refresh", "Refresh app list before selecting")
    .option("--recent", "Parse recent logs and exit")
    .option("--out <fileName>", "Write parsed HTTP events to a file")
    .option("--skip-org-select", "Use current CF org/space without asking")
    .action(runHttpWatchCommand);

  cfCommand
    .command("request-trace-doctor")
    .description("Diagnose why deep request-trace may not capture body/header in a BTP Node.js app")
    .option("--app <appName>", "BTP app name. Use comma-separated names")
    .option("--refresh", "Refresh app list before selecting")
    .option("--instance <index>", "App instance index", "0")
    .option("--process <processName>", "CF process name for multi-process apps")
    .option("--local-port <port>", "First local inspector port", "9329")
    .option("--remote-port <port>", "Remote inspector port in app container", "9229")
    .option("--max-body-bytes <bytes>", "Maximum request/response body bytes to print", "20000")
    .option("--skip-org-select", "Use current CF org/space without asking")
    .action(runRequestTraceDoctorCommand);

  cfCommand
    .command("request-trace")
    .alias("network-trace")
    .alias("traffic")
    .description("Watch incoming HTTP requests from BTP Node.js apps without editing backend source code")
    .option("--app <appName>", "BTP app name. Use comma-separated names to trace multiple apps")
    .option("--refresh", "Refresh app list before selecting")
    .option("--instance <index>", "App instance index", "0")
    .option("--process <processName>", "CF process name for multi-process apps")
    .option("--local-port <port>", "First local inspector port", "9329")
    .option("--remote-port <port>", "Remote inspector port in app container", "9229")
    .option("--max-body-bytes <bytes>", "Maximum request/response body bytes to print", "20000")
    .option("--out <fileName>", "Export captured trace events to a JSONL file")
    .option("--skip-org-select", "Use current CF org/space without asking")
    .action(runRequestTraceCommand);

  cfCommand
    .command("apps-cache-refresh")
    .description("Refresh cached cf apps for current target. Internal command used by smdg cf apps.")
    .action(runAppsCacheRefreshCommand);

  registerCloudFoundryDbCommands(cfCommand);

  cfCommand.command("cache").description("Print cached Cloud Foundry values").action(runCacheCommand);
}
