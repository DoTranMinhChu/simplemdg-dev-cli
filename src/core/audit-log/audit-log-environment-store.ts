import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const ENVIRONMENTS_FILE_PATH = path.join(CACHE_DIRECTORY, "audit-log-environments.json");

/**
 * One monitored BTP environment for the Audit Log Monitor feature: "project" (a free-text
 * grouping label, e.g. "SimpleMDG" / "VICOR") -> "environment" (a specific CF org/space, e.g.
 * S4 DEV 2023). Deliberately separate from `deploy-targets.json` (`TDeployTarget`): a deploy
 * target is 1 project -> 1 default CF target used for deploying model changes; this store is
 * 1 project -> N environments to monitor, a different cardinality.
 *
 * `connectionId` points at an encrypted profile in db-connections.json (see db-cache.ts) —
 * once set, `StudioConnectionPool` reuses that cached, already-decrypted-on-demand credential
 * on every subsequent scan, so re-registering the same app/environment never re-prompts for
 * BTP/HANA credentials (`upsertConnectionFromDraft` in db-cache.ts dedupes by
 * region+org+space+app+serviceName+type — every one of those must match, not just app+service,
 * or two different environments that happen to share an app-naming convention would collide onto
 * the same connection row and silently overwrite each other's credentials).
 *
 * Deliberately has no "which codebase fork does this run" tag: whether a given log table exists
 * in a given environment is always answered by live-probing the schema (see
 * audit-log-table-resolver.ts) — a manually-picked label would just be one more thing to keep
 * in sync and get wrong. Tables that don't exist here simply resolve to zero matches and are
 * left out of the UI, no annotation needed.
 */
export type TAuditLogEnvironment = {
  id: string;
  projectName: string;
  envLabel: string;
  cfTargetKey: string;
  region: string;
  org: string;
  space: string;
  appName: string;
  connectionId: string;
  createdAt: string;
  updatedAt: string;
  lastScannedAt?: string;
};

export type TAuditLogEnvironmentDraft = Partial<Omit<TAuditLogEnvironment, "id" | "createdAt" | "updatedAt" | "lastScannedAt">> &
  Pick<TAuditLogEnvironment, "projectName" | "envLabel" | "cfTargetKey" | "region" | "org" | "space" | "appName" | "connectionId"> & {
    id?: string;
  };

type TEnvironmentsCacheFile = {
  environments: TAuditLogEnvironment[];
};

async function readCacheFile(): Promise<TEnvironmentsCacheFile> {
  if (!(await fs.pathExists(ENVIRONMENTS_FILE_PATH))) return { environments: [] };
  const parsed = (await fs.readJson(ENVIRONMENTS_FILE_PATH).catch(() => ({ environments: [] }))) as Partial<TEnvironmentsCacheFile>;
  return { environments: Array.isArray(parsed.environments) ? parsed.environments : [] };
}

async function writeCacheFile(cache: TEnvironmentsCacheFile): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  await fs.writeJson(ENVIRONMENTS_FILE_PATH, cache, { spaces: 2 });
}

export async function listAuditLogEnvironments(): Promise<TAuditLogEnvironment[]> {
  const cache = await readCacheFile();
  return cache.environments.sort((left, right) => {
    const byProject = left.projectName.localeCompare(right.projectName);
    return byProject !== 0 ? byProject : left.envLabel.localeCompare(right.envLabel);
  });
}

export async function findAuditLogEnvironment(id: string): Promise<TAuditLogEnvironment | undefined> {
  const cache = await readCacheFile();
  return cache.environments.find((environment) => environment.id === id);
}

export async function upsertAuditLogEnvironment(draft: TAuditLogEnvironmentDraft): Promise<TAuditLogEnvironment> {
  const cache = await readCacheFile();
  const now = new Date().toISOString();
  const existingIndex = draft.id ? cache.environments.findIndex((environment) => environment.id === draft.id) : -1;
  const existing = existingIndex >= 0 ? cache.environments[existingIndex] : undefined;

  const environment: TAuditLogEnvironment = {
    id: existing?.id ?? draft.id ?? crypto.randomUUID(),
    projectName: draft.projectName,
    envLabel: draft.envLabel,
    cfTargetKey: draft.cfTargetKey,
    region: draft.region,
    org: draft.org,
    space: draft.space,
    appName: draft.appName,
    connectionId: draft.connectionId,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastScannedAt: existing?.lastScannedAt,
  };

  if (existingIndex >= 0) cache.environments[existingIndex] = environment;
  else cache.environments.push(environment);

  await writeCacheFile(cache);
  return environment;
}

export async function removeAuditLogEnvironment(id: string): Promise<boolean> {
  const cache = await readCacheFile();
  const next = cache.environments.filter((environment) => environment.id !== id);
  const removed = next.length !== cache.environments.length;
  if (removed) await writeCacheFile({ environments: next });
  return removed;
}

export async function touchAuditLogEnvironmentScan(id: string): Promise<void> {
  const cache = await readCacheFile();
  const environment = cache.environments.find((item) => item.id === id);
  if (!environment) return;
  environment.lastScannedAt = new Date().toISOString();
  await writeCacheFile(cache);
}
