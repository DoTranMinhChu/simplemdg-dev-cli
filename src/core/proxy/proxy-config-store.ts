import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  TProxyConfigDefaults,
  TProxyConfigFile,
  TProxyEnvironmentDefinition,
  TProxyUserCredential,
  TResolvedProxyEnvironment,
} from "./proxy-types";
import { decryptSecret } from "../db/db-crypto";
import { resolveProxyConfigPath as resolveProxyConfigPathFromLocation } from "./proxy-config-location";

export const DEFAULT_PROXY_PORTS = [3000, 3001];

const DEFAULT_LOGIN_SELECTORS = {
  usernameSelector:
    'input[name="username"], input[name="email"], input[name="j_username"], input[id="j_username"], input[type="email"], input[id*="user"]',
  passwordSelector:
    'input[name="password"], input[name="j_password"], input[id="j_password"], input[type="password"], input[id*="pass"]',
  submitSelector: 'button[type="submit"], input[type="submit"], button[name="login"], button[id*="login"]',
  postLoginWaitMs: 1000,
};

const DEFAULT_CAPTURE_CONFIG = {
  requestUrlPattern: "srv-approver/ApproverService/myInbox|srv-process/CommonProcessService/getBusinessRequest",
  allowHeaders: [
    "accept",
    "accept-language",
    "application-interface-key",
    "content-type",
    "cookie",
    "referer",
    "x-correlation-id",
    "x-csrf-token",
  ],
  acceptLanguage: "en-US",
};

/**
 * Resolves the path `environments.json` lives at — a single local file under
 * `~/.simplemdg/proxy/` (see `proxy-config-location.ts`), never guessed from
 * `process.cwd()`'s nearest `.git`. `smdg` is a globally installed CLI invoked from anywhere,
 * so cwd-based repo detection would silently land the config wherever the terminal happens
 * to be.
 */
export function resolveProxyConfigPath(explicitDir?: string): string {
  return resolveProxyConfigPathFromLocation(explicitDir);
}

export function sanitizeProxyIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function proxyEnvironmentId(repo: string, name: string): string {
  return sanitizeProxyIdentifier(`${repo}-${name}`);
}

function normalizeEnvUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function emptyConfig(): TProxyConfigFile {
  return { defaults: {}, environments: [] };
}

export function readProxyConfigFile(configPath: string): TProxyConfigFile {
  if (!existsSync(configPath)) {
    return emptyConfig();
  }

  const raw = readFileSync(configPath, "utf8").trim();
  if (!raw) {
    return emptyConfig();
  }

  const parsed = JSON.parse(raw) as TProxyConfigFile;
  return { defaults: parsed.defaults ?? {}, environments: parsed.environments ?? [] };
}

export function writeProxyConfigFile(configPath: string, config: TProxyConfigFile): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function resolveProxyEnvironment(
  item: TProxyEnvironmentDefinition,
  defaults: TProxyConfigDefaults,
): TResolvedProxyEnvironment {
  // Passwords are stored raw; `decryptSecret` is a no-op passthrough for those and only
  // does real work for any older `enc:`-prefixed entry still on disk from before.
  const decryptedUsers: TProxyUserCredential[] = (item.userList ?? [])
    .filter((user) => Boolean(user.userID) && Boolean(user.password))
    .map((user) => ({ userID: user.userID, password: decryptSecret(user.password) }));

  return {
    id: proxyEnvironmentId(item.repo, item.name),
    displayName: `${item.repo} - ${item.name}`,
    repo: item.repo,
    name: item.name,
    url: normalizeEnvUrl(item.url),
    userList: decryptedUsers,
    knownUserIds: (item.userList ?? []).map((user) => user.userID).filter(Boolean),
    ports: item.ports && item.ports.length > 0 ? item.ports : DEFAULT_PROXY_PORTS,
    captureMode: item.captureMode ?? defaults.captureMode ?? "auto",
    login: { ...DEFAULT_LOGIN_SELECTORS, ...defaults.login, ...item.login },
    capture: { ...DEFAULT_CAPTURE_CONFIG, ...defaults.capture, ...item.capture },
  };
}

export function loadResolvedProxyEnvironments(configPath: string): TResolvedProxyEnvironment[] {
  const config = readProxyConfigFile(configPath);
  return config.environments.map((item) => resolveProxyEnvironment(item, config.defaults ?? {}));
}

export function findResolvedProxyEnvironment(configPath: string, envId: string): TResolvedProxyEnvironment | undefined {
  return loadResolvedProxyEnvironments(configPath).find((environment) => environment.id === envId);
}

export function resolveProxyUserCredential(
  env: TResolvedProxyEnvironment,
  requestedUserID?: string,
): TProxyUserCredential {
  if (env.userList.length === 0) {
    throw new Error(`No users are configured for ${env.displayName}. Run "smdg proxy add" to add one.`);
  }

  if (requestedUserID) {
    const selected = env.userList.find((user) => user.userID === requestedUserID);
    if (!selected) {
      throw new Error(`User ${requestedUserID} is not configured for ${env.displayName}.`);
    }
    return selected;
  }

  return env.userList[0];
}

/** Creates the environment if it doesn't already exist (matched by repo+name). */
export function upsertProxyEnvironment(
  configPath: string,
  repo: string,
  name: string,
  url: string,
): { envId: string; created: boolean } {
  const config = readProxyConfigFile(configPath);
  const envId = proxyEnvironmentId(repo, name);
  const existing = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);

  if (existing) {
    return { envId, created: false };
  }

  config.environments.push({ repo, name, url: normalizeEnvUrl(url), userList: [] });
  writeProxyConfigFile(configPath, config);
  return { envId, created: true };
}

export type TUpdateProxyEnvironmentResult = { envId: string; idChanged: boolean };

/** Edits repo/name/url of an existing environment; repo/name changes may change its derived id. */
export function updateProxyEnvironment(
  configPath: string,
  envId: string,
  updates: { repo: string; name: string; url: string },
): TUpdateProxyEnvironmentResult {
  const config = readProxyConfigFile(configPath);
  const env = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);
  if (!env) {
    throw new Error(`Environment ${envId} not found in ${configPath}.`);
  }

  const newEnvId = proxyEnvironmentId(updates.repo, updates.name);
  if (newEnvId !== envId && config.environments.some((item) => proxyEnvironmentId(item.repo, item.name) === newEnvId)) {
    throw new Error(`An environment with repo/name resolving to "${newEnvId}" already exists.`);
  }

  env.repo = updates.repo;
  env.name = updates.name;
  env.url = normalizeEnvUrl(updates.url);
  writeProxyConfigFile(configPath, config);

  return { envId: newEnvId, idChanged: newEnvId !== envId };
}

/** For a duplicate-URL guard when adding/editing — same URL configured under a different environment. */
export function findProxyEnvironmentByUrl(
  configPath: string,
  url: string,
  excludeEnvId?: string,
): TResolvedProxyEnvironment | undefined {
  const normalized = normalizeEnvUrl(url).toLowerCase();
  return loadResolvedProxyEnvironments(configPath).find(
    (environment) => environment.id !== excludeEnvId && environment.url.toLowerCase() === normalized,
  );
}

export function addOrUpdateProxyUser(configPath: string, envId: string, userID: string, plainPassword: string): void {
  const config = readProxyConfigFile(configPath);
  const env = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);

  if (!env) {
    throw new Error(`Environment ${envId} not found in ${configPath}.`);
  }

  env.userList = env.userList ?? [];
  const existingUser = env.userList.find((user) => user.userID === userID);

  if (existingUser) {
    existingUser.password = plainPassword;
  } else {
    env.userList.push({ userID, password: plainPassword });
  }

  writeProxyConfigFile(configPath, config);
}

/** Renames a user and/or changes their password; leaving `password` empty keeps the current one. */
export function updateProxyUser(
  configPath: string,
  envId: string,
  originalUserID: string,
  updates: { userID: string; password?: string },
): void {
  const config = readProxyConfigFile(configPath);
  const env = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);

  if (!env || !env.userList) {
    throw new Error(`Environment ${envId} not found in ${configPath}.`);
  }

  const existingUser = env.userList.find((user) => user.userID === originalUserID);
  if (!existingUser) {
    throw new Error(`User ${originalUserID} not found for ${envId}.`);
  }

  if (updates.userID !== originalUserID && env.userList.some((user) => user.userID === updates.userID)) {
    throw new Error(`User ${updates.userID} already exists for ${envId}.`);
  }

  existingUser.userID = updates.userID;
  if (updates.password) {
    existingUser.password = updates.password;
  }

  writeProxyConfigFile(configPath, config);
}

/** Returns a previously-saved password so the Studio can show it back on request. */
export function revealProxyUserPassword(configPath: string, envId: string, userID: string): string {
  const config = readProxyConfigFile(configPath);
  const env = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);
  const user = env?.userList?.find((item) => item.userID === userID);

  if (!user) {
    throw new Error(`User ${userID} not found for ${envId}.`);
  }

  return decryptSecret(user.password);
}

export function deleteProxyUser(configPath: string, envId: string, userID: string): boolean {
  const config = readProxyConfigFile(configPath);
  const env = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);
  if (!env || !env.userList) {
    return false;
  }

  const originalLength = env.userList.length;
  env.userList = env.userList.filter((user) => user.userID !== userID);
  if (env.userList.length === originalLength) {
    return false;
  }

  writeProxyConfigFile(configPath, config);
  return true;
}

export function deleteProxyEnvironment(configPath: string, envId: string): boolean {
  const config = readProxyConfigFile(configPath);
  const originalLength = config.environments.length;
  config.environments = config.environments.filter((item) => proxyEnvironmentId(item.repo, item.name) !== envId);

  if (config.environments.length === originalLength) {
    return false;
  }

  writeProxyConfigFile(configPath, config);
  return true;
}

export function setProxyEnvironmentPorts(configPath: string, envId: string, ports: number[]): void {
  const config = readProxyConfigFile(configPath);
  const env = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);
  if (!env) {
    throw new Error(`Environment ${envId} not found in ${configPath}.`);
  }

  env.ports = ports;
  writeProxyConfigFile(configPath, config);
}

/**
 * Exports the config as plain JSON — a real backup of everything, including raw passwords,
 * by default. Passwords are stored raw already; `decryptSecret` here just normalizes any
 * older `enc:`-prefixed entry back to raw too, so the exported file is plain text either way
 * (portable across machines, human-readable). Pass `redactPasswords: true` for the rarer
 * case of handing a sanitized copy to someone else.
 */
export function exportProxyConfig(configPath: string, options: { redactPasswords?: boolean } = {}): TProxyConfigFile {
  const config = readProxyConfigFile(configPath);

  return {
    defaults: config.defaults,
    environments: config.environments.map((env) => ({
      ...env,
      userList: (env.userList ?? []).map((user) => ({
        userID: user.userID,
        password: options.redactPasswords || !user.password ? "" : decryptSecret(user.password),
      })),
    })),
  };
}

export type TProxyImportResult = {
  addedEnvironments: number;
  updatedEnvironments: number;
  addedUsers: number;
  /** Users that already exist locally — their (possibly the only working) password is never overwritten by an import. */
  skippedUsers: number;
};

/**
 * Imports environments from a previously-exported file. Default (merge) mode is additive and
 * safe to run repeatedly: new environments/users are added, existing environments have their
 * non-secret fields (url/ports/capture config) refreshed, and an existing user's password is
 * NEVER touched by a merge — overwriting a locally-working one would break your own setup.
 * `overwrite: true` instead replaces the whole file with the imported one verbatim (intended
 * for restoring a full backup — passwords are stored raw, so this works on any machine).
 */
export function importProxyConfig(
  configPath: string,
  imported: TProxyConfigFile,
  options: { overwrite?: boolean } = {},
): TProxyImportResult {
  const result: TProxyImportResult = { addedEnvironments: 0, updatedEnvironments: 0, addedUsers: 0, skippedUsers: 0 };

  if (options.overwrite) {
    const environments = imported.environments.map((env) => ({ ...env, userList: env.userList ?? [] }));
    writeProxyConfigFile(configPath, { defaults: imported.defaults ?? {}, environments });
    result.addedEnvironments = environments.length;
    result.addedUsers = environments.reduce((total, env) => total + env.userList.length, 0);
    return result;
  }

  const config = readProxyConfigFile(configPath);

  for (const importedEnv of imported.environments) {
    const envId = proxyEnvironmentId(importedEnv.repo, importedEnv.name);
    const existingEnv = config.environments.find((item) => proxyEnvironmentId(item.repo, item.name) === envId);
    const importedUserList = importedEnv.userList ?? [];

    if (!existingEnv) {
      config.environments.push({ ...importedEnv, userList: importedUserList });
      result.addedEnvironments += 1;
      result.addedUsers += importedUserList.length;
      continue;
    }

    existingEnv.url = importedEnv.url || existingEnv.url;
    existingEnv.ports = importedEnv.ports ?? existingEnv.ports;
    existingEnv.captureMode = importedEnv.captureMode ?? existingEnv.captureMode;
    existingEnv.login = importedEnv.login ?? existingEnv.login;
    existingEnv.capture = importedEnv.capture ?? existingEnv.capture;
    result.updatedEnvironments += 1;

    existingEnv.userList = existingEnv.userList ?? [];
    for (const importedUser of importedUserList) {
      if (existingEnv.userList.some((user) => user.userID === importedUser.userID)) {
        result.skippedUsers += 1;
        continue;
      }
      existingEnv.userList.push(importedUser);
      result.addedUsers += 1;
    }
  }

  writeProxyConfigFile(configPath, config);
  return result;
}
