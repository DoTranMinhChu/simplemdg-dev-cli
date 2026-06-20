import { readAllEntries, readEntry, removeEntry, writeEntry } from "../cache/smart-cache-store";
import { cfTargetKey } from "./cf-target.types";
import type { TCfTarget } from "./cf-target.types";
import type { TSmartCacheEntry } from "../cache/smart-cache.types";

const FAVORITES_NAMESPACE = "cf-favorite-targets";
const RECENT_NAMESPACE = "cf-recent-targets";
const MAX_RECENT = 20;

function toEntry(target: TCfTarget): TSmartCacheEntry<TCfTarget> {
  const now = new Date().toISOString();
  return {
    key: cfTargetKey(target),
    data: target,
    createdAt: now,
    updatedAt: target.lastUsedAt ?? now,
    source: "cache",
    status: "fresh",
    ttlMs: Number.POSITIVE_INFINITY,
    version: 1,
  };
}

export async function listFavoriteTargets(): Promise<TCfTarget[]> {
  const entries = await readAllEntries<TCfTarget>(FAVORITES_NAMESPACE);
  return Object.values(entries).map((entry) => ({ ...entry.data, isFavorite: true }));
}

export async function isFavoriteTarget(target: TCfTarget): Promise<boolean> {
  return Boolean(await readEntry<TCfTarget>(FAVORITES_NAMESPACE, cfTargetKey(target)));
}

export async function addFavoriteTarget(target: TCfTarget): Promise<void> {
  await writeEntry(FAVORITES_NAMESPACE, cfTargetKey(target), toEntry({ ...target, isFavorite: true }));
}

export async function removeFavoriteTarget(target: TCfTarget): Promise<void> {
  await removeEntry(FAVORITES_NAMESPACE, cfTargetKey(target));
}

export async function listRecentTargets(limit = 10): Promise<TCfTarget[]> {
  const entries = await readAllEntries<TCfTarget>(RECENT_NAMESPACE);
  return Object.values(entries)
    .map((entry) => entry.data)
    .sort((left, right) => String(right.lastUsedAt ?? "").localeCompare(String(left.lastUsedAt ?? "")))
    .slice(0, limit);
}

export async function addRecentTarget(target: TCfTarget): Promise<void> {
  const recent: TCfTarget = { ...target, lastUsedAt: new Date().toISOString() };
  await writeEntry(RECENT_NAMESPACE, cfTargetKey(recent), toEntry(recent));

  const entries = await readAllEntries<TCfTarget>(RECENT_NAMESPACE);
  const sorted = Object.values(entries)
    .map((entry) => entry.data)
    .sort((left, right) => String(right.lastUsedAt ?? "").localeCompare(String(left.lastUsedAt ?? "")));

  for (const stale of sorted.slice(MAX_RECENT)) {
    await removeEntry(RECENT_NAMESPACE, cfTargetKey(stale)).catch(() => undefined);
  }
}
