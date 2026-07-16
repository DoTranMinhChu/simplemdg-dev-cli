import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import type { TCdsVersion, TDiscoveredObjectType } from "./object-type-discovery";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const DEPLOY_TARGETS_FILE_PATH = path.join(CACHE_DIRECTORY, "deploy-targets.json");

/**
 * No auto-load signal exists for this anywhere in the customer repos we
 * researched (confirmed: no `objectTypeMode`/`object_type_mode` field found)
 * — it stays a plain user-editable enum, seeded with the legacy tool's known
 * values as suggestions.
 */
export type TObjectTypeMode = "eventmesh" | "eventmesh_v1.6+" | "multiple_erp" | "multiple_erp_central" | "buma" | "SAP_SF" | "natrol_ecc" | "custom";

export type TDeployTarget = {
  id: string;
  /** User label, e.g. "S4 UAT" — replaces the old tool's environment-code lookup (group-sap.json). */
  name: string;
  gitlabBaseUrl: string;
  gitlabGroupId: number;
  gitlabGroupPath: string;
  defaultBranch: string;
  cfTargetKey?: string;
  objectTypeMode: TObjectTypeMode;
  cdsVersionDefault: TCdsVersion;
  isConsolidationDefault: boolean;
  /** Soft-validated MR title prefixes (warn, not block — the old hard gate's only real job was data-entry hygiene). */
  ticketCodes: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type TDeployTargetDraft = Partial<Omit<TDeployTarget, "id" | "createdAt" | "updatedAt">> &
  Pick<TDeployTarget, "name" | "gitlabBaseUrl" | "gitlabGroupId" | "gitlabGroupPath" | "defaultBranch" | "objectTypeMode" | "cdsVersionDefault" | "isConsolidationDefault"> & { id?: string };

/** Per (target, object type) override — undefined fields inherit the target's default. */
export type TObjectTypeSettings = {
  deployTargetId: string;
  objectTypeSlug: string;
  cdsVersion?: TCdsVersion;
  isConsolidation?: boolean;
  source: "auto-suggested" | "user-override";
  suggestedAt?: string;
};

type TDeployTargetCacheFile = {
  targets: TDeployTarget[];
  objectTypeSettings: TObjectTypeSettings[];
  /** Manually-added object types for repos without `_laidonBuild.yaml`, keyed by `${gitlabBaseUrl}::${groupId}`. */
  manualObjectTypes: Record<string, TDiscoveredObjectType[]>;
};

function emptyCache(): TDeployTargetCacheFile {
  return { targets: [], objectTypeSettings: [], manualObjectTypes: {} };
}

async function readCacheFile(): Promise<TDeployTargetCacheFile> {
  if (!(await fs.pathExists(DEPLOY_TARGETS_FILE_PATH))) return emptyCache();
  const parsed = await fs.readJson(DEPLOY_TARGETS_FILE_PATH).catch(() => emptyCache()) as Partial<TDeployTargetCacheFile>;
  return {
    targets: parsed.targets ?? [],
    objectTypeSettings: parsed.objectTypeSettings ?? [],
    manualObjectTypes: parsed.manualObjectTypes ?? {},
  };
}

async function writeCacheFile(cache: TDeployTargetCacheFile): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  await fs.writeJson(DEPLOY_TARGETS_FILE_PATH, cache, { spaces: 2 });
}

export function buildGroupKey(gitlabBaseUrl: string, groupId: number): string {
  return `${gitlabBaseUrl.trim().replace(/\/+$/, "")}::${groupId}`;
}

// --- Deploy targets ----------------------------------------------------------

export async function listDeployTargets(): Promise<TDeployTarget[]> {
  const cache = await readCacheFile();
  return cache.targets.sort((left, right) => (right.lastUsedAt ?? right.updatedAt).localeCompare(left.lastUsedAt ?? left.updatedAt));
}

export async function findDeployTarget(id: string): Promise<TDeployTarget | undefined> {
  const cache = await readCacheFile();
  return cache.targets.find((target) => target.id === id);
}

export async function upsertDeployTarget(draft: TDeployTargetDraft): Promise<TDeployTarget> {
  const cache = await readCacheFile();
  const now = new Date().toISOString();
  const existingIndex = draft.id ? cache.targets.findIndex((target) => target.id === draft.id) : -1;
  const existing = existingIndex >= 0 ? cache.targets[existingIndex] : undefined;

  const target: TDeployTarget = {
    id: existing?.id ?? draft.id ?? crypto.randomUUID(),
    name: draft.name,
    gitlabBaseUrl: draft.gitlabBaseUrl,
    gitlabGroupId: draft.gitlabGroupId,
    gitlabGroupPath: draft.gitlabGroupPath,
    defaultBranch: draft.defaultBranch,
    cfTargetKey: draft.cfTargetKey ?? existing?.cfTargetKey,
    objectTypeMode: draft.objectTypeMode,
    cdsVersionDefault: draft.cdsVersionDefault,
    isConsolidationDefault: draft.isConsolidationDefault,
    ticketCodes: draft.ticketCodes ?? existing?.ticketCodes ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt,
  };

  if (existingIndex >= 0) cache.targets[existingIndex] = target;
  else cache.targets.push(target);

  await writeCacheFile(cache);
  return target;
}

export async function removeDeployTarget(id: string): Promise<boolean> {
  const cache = await readCacheFile();
  const nextTargets = cache.targets.filter((target) => target.id !== id);
  const removed = nextTargets.length !== cache.targets.length;
  if (removed) {
    await writeCacheFile({ ...cache, targets: nextTargets, objectTypeSettings: cache.objectTypeSettings.filter((setting) => setting.deployTargetId !== id) });
  }
  return removed;
}

export async function touchDeployTargetUsage(id: string): Promise<void> {
  const cache = await readCacheFile();
  const target = cache.targets.find((item) => item.id === id);
  if (!target) return;
  target.lastUsedAt = new Date().toISOString();
  await writeCacheFile(cache);
}

// --- Per-object-type settings --------------------------------------------------

export async function listObjectTypeSettings(deployTargetId: string): Promise<TObjectTypeSettings[]> {
  const cache = await readCacheFile();
  return cache.objectTypeSettings.filter((setting) => setting.deployTargetId === deployTargetId);
}

export async function upsertObjectTypeSetting(setting: TObjectTypeSettings): Promise<TObjectTypeSettings> {
  const cache = await readCacheFile();
  const index = cache.objectTypeSettings.findIndex((item) => item.deployTargetId === setting.deployTargetId && item.objectTypeSlug === setting.objectTypeSlug);
  if (index >= 0) cache.objectTypeSettings[index] = setting;
  else cache.objectTypeSettings.push(setting);
  await writeCacheFile(cache);
  return setting;
}

// --- Manual object-type overrides (repos without _laidonBuild.yaml) -----------

export async function listManualObjectTypes(groupKey: string): Promise<TDiscoveredObjectType[]> {
  const cache = await readCacheFile();
  return cache.manualObjectTypes[groupKey] ?? [];
}

export async function addManualObjectType(groupKey: string, entry: TDiscoveredObjectType): Promise<void> {
  const cache = await readCacheFile();
  const existing = cache.manualObjectTypes[groupKey] ?? [];
  cache.manualObjectTypes[groupKey] = [...existing.filter((item) => item.slug !== entry.slug), entry];
  await writeCacheFile(cache);
}

export async function removeManualObjectType(groupKey: string, slug: string): Promise<void> {
  const cache = await readCacheFile();
  const existing = cache.manualObjectTypes[groupKey] ?? [];
  cache.manualObjectTypes[groupKey] = existing.filter((item) => item.slug !== slug);
  await writeCacheFile(cache);
}

/** Manual entries win on slug conflict — same layering as favorites-over-scan-results elsewhere in the CLI. */
export function mergeObjectTypesWithManual(discovered: TDiscoveredObjectType[], manual: TDiscoveredObjectType[]): TDiscoveredObjectType[] {
  const bySlug = new Map(discovered.map((item) => [item.slug, item]));
  for (const item of manual) bySlug.set(item.slug, item);
  return Array.from(bySlug.values()).sort((left, right) => left.slug.localeCompare(right.slug));
}
