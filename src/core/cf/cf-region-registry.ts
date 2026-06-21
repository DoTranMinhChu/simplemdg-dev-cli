import { inferCloudFoundryRegionFromApiEndpoint } from "../cf";
import { readAllEntries, removeEntry, writeEntry } from "../cache/smart-cache-store";
import type { TSmartCacheEntry } from "../cache/smart-cache.types";

/**
 * A configured CF region endpoint. Regions are first-class, user-manageable
 * objects shared by every CF command and the DB Studio. Stored as a smart-cache
 * namespace (`~/.simplemdg/cache/cf-regions.json`) so the registry survives
 * across sessions and is editable from both CLI and Studio.
 */
export type TCfRegionEndpoint = {
  region: string;
  apiEndpoint: string;
  label?: string;
  enabled: boolean;
  isCustom?: boolean;
};

const REGIONS_NAMESPACE = "cf-regions";

/**
 * Built-in SAP BTP Cloud Foundry region endpoints. Enabled by default so the
 * cross-region scanner keeps its previous behaviour; users may disable the ones
 * they do not use to speed up scans.
 */
const DEFAULT_REGION_ENDPOINTS = [
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

export const DEFAULT_CF_REGIONS: TCfRegionEndpoint[] = DEFAULT_REGION_ENDPOINTS.map((apiEndpoint) => ({
  region: inferCloudFoundryRegionFromApiEndpoint(apiEndpoint),
  apiEndpoint,
  enabled: true,
  isCustom: false,
}));

function toEntry(region: TCfRegionEndpoint): TSmartCacheEntry<TCfRegionEndpoint> {
  const now = new Date().toISOString();
  return {
    key: region.region,
    data: region,
    createdAt: now,
    updatedAt: now,
    source: "cache",
    status: "fresh",
    refreshState: "idle",
    ttlMs: Number.POSITIVE_INFINITY,
    version: 1,
  };
}

/** Seed the registry with built-in regions the first time it is read. */
async function ensureSeeded(): Promise<Record<string, TSmartCacheEntry<TCfRegionEndpoint>>> {
  const entries = await readAllEntries<TCfRegionEndpoint>(REGIONS_NAMESPACE);

  if (Object.keys(entries).length > 0) {
    return entries;
  }

  for (const region of DEFAULT_CF_REGIONS) {
    await writeEntry(REGIONS_NAMESPACE, region.region, toEntry(region));
  }

  return readAllEntries<TCfRegionEndpoint>(REGIONS_NAMESPACE);
}

/** All configured regions (built-in + custom), sorted by region name. */
export async function listRegions(): Promise<TCfRegionEndpoint[]> {
  const entries = await ensureSeeded();
  return Object.values(entries)
    .map((entry) => entry.data)
    .sort((left, right) => left.region.localeCompare(right.region));
}

/** Only the regions the user has left enabled. */
export async function listEnabledRegions(): Promise<TCfRegionEndpoint[]> {
  return (await listRegions()).filter((region) => region.enabled);
}

/** Enabled region API endpoints — the input for the cross-region scanner. */
export async function getEnabledRegionEndpoints(): Promise<string[]> {
  return (await listEnabledRegions()).map((region) => region.apiEndpoint);
}

export async function setRegionEnabled(region: string, enabled: boolean): Promise<void> {
  const entries = await ensureSeeded();
  const existing = entries[region];

  if (!existing) {
    return;
  }

  await writeEntry(REGIONS_NAMESPACE, region, toEntry({ ...existing.data, enabled }));
}

/**
 * Add (or update) a custom region. The region name is derived from the API
 * endpoint when not supplied.
 */
export async function addCustomRegion(input: { apiEndpoint: string; region?: string; label?: string }): Promise<TCfRegionEndpoint> {
  await ensureSeeded();
  const apiEndpoint = input.apiEndpoint.trim();
  const region = (input.region?.trim() || inferCloudFoundryRegionFromApiEndpoint(apiEndpoint)).toLowerCase();
  const record: TCfRegionEndpoint = {
    region,
    apiEndpoint,
    label: input.label?.trim() || undefined,
    enabled: true,
    isCustom: true,
  };
  await writeEntry(REGIONS_NAMESPACE, region, toEntry(record));
  return record;
}

/**
 * Remove a region. Built-in regions cannot be deleted (they would be re-seeded);
 * instead they are disabled. Custom regions are removed entirely.
 */
export async function removeRegion(region: string): Promise<void> {
  const entries = await ensureSeeded();
  const existing = entries[region];

  if (!existing) {
    return;
  }

  if (existing.data.isCustom) {
    await removeEntry(REGIONS_NAMESPACE, region);
    return;
  }

  await setRegionEnabled(region, false);
}
