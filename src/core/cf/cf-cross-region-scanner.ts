import { parseCloudFoundryNameList, readCloudFoundryTarget } from "../cf";
import { runCommand } from "../process";
import { emitCacheEvent } from "../cache/smart-cache-events";
import { readAllEntries, readEntry, writeEntry } from "../cache/smart-cache-store";
import { listEnabledRegions } from "./cf-region-registry";
import type { TCfRegionEndpoint } from "./cf-region-registry";
import { buildCfTargetId, cfTargetKey, detectCfEnvironment } from "./cf-target.types";
import type { TCfTarget } from "./cf-target.types";
import type { TSmartCacheEntry } from "../cache/smart-cache.types";
import { DEFAULT_CACHE_TTL } from "../cache/smart-cache.types";

export const CROSS_REGION_TARGETS_NAMESPACE = "cf-cross-region-targets";

export type TCfScanCredential = { apiEndpoint: string; username: string; password?: string };

/** Per-region scan result stored under the cross-region targets namespace. */
type TRegionTargetsPayload = {
  region: string;
  apiEndpoint: string;
  targets: TCfTarget[];
  scanStatus: "success" | "failed";
  scanError?: string;
};

export type TCfRegionScanResult = {
  region: string;
  apiEndpoint: string;
  status: "success" | "failed";
  targetCount: number;
  error?: string;
  usedCache: boolean;
};

export type TCfScanSummary = {
  targets: TCfTarget[];
  regionResults: TCfRegionScanResult[];
  totalTargets: number;
  failedRegions: number;
  updatedAt: string;
};

function regionEntry(payload: TRegionTargetsPayload): TSmartCacheEntry<TRegionTargetsPayload> {
  const now = new Date().toISOString();
  return {
    key: payload.region,
    data: payload,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + DEFAULT_CACHE_TTL.cfOrgs).toISOString(),
    source: "network",
    status: "fresh",
    refreshState: payload.scanStatus === "success" ? "success" : "failed",
    lastRefreshFinishedAt: now,
    lastRefreshError: payload.scanError,
    ttlMs: DEFAULT_CACHE_TTL.cfOrgs,
    version: 1,
  };
}

/** Try `cf orgs`; if unauthenticated, attempt cached-credential re-login. */
async function fetchOrgsWithRelogin(apiEndpoint: string, credentials: TCfScanCredential[]): Promise<string[] | undefined> {
  let result = await runCommand("cf", ["orgs"]);

  if (result.exitCode === 0) {
    return parseCloudFoundryNameList(result.stdout, "name");
  }

  // Re-login: prefer credentials saved for this endpoint, then any other.
  const ordered = [
    ...credentials.filter((item) => item.apiEndpoint === apiEndpoint && item.password?.trim()),
    ...credentials.filter((item) => item.apiEndpoint !== apiEndpoint && item.password?.trim()),
  ];
  const tried = new Set<string>();

  for (const credential of ordered) {
    const id = `${credential.username}|${credential.password ?? ""}`;
    if (tried.has(id)) continue;
    tried.add(id);

    const auth = await runCommand("cf", ["auth", credential.username, credential.password as string]);
    if (auth.exitCode !== 0) continue;

    result = await runCommand("cf", ["orgs"]);
    if (result.exitCode === 0) {
      return parseCloudFoundryNameList(result.stdout, "name");
    }
  }

  return undefined;
}

async function scanRegion(region: TCfRegionEndpoint, credentials: TCfScanCredential[]): Promise<TCfTarget[]> {
  const apiResult = await runCommand("cf", ["api", region.apiEndpoint]);
  if (apiResult.exitCode !== 0) {
    throw new Error(`Cannot reach ${region.apiEndpoint}`);
  }

  const orgs = await fetchOrgsWithRelogin(region.apiEndpoint, credentials);
  if (!orgs) {
    throw new Error(`Not authenticated for ${region.region}`);
  }

  const now = new Date().toISOString();
  const targets: TCfTarget[] = [];

  for (const org of orgs) {
    let spaces: string[] = [];
    const orgTarget = await runCommand("cf", ["target", "-o", org]);
    if (orgTarget.exitCode === 0) {
      const spacesResult = await runCommand("cf", ["spaces"]);
      spaces = spacesResult.exitCode === 0 ? parseCloudFoundryNameList(spacesResult.stdout, "name") : [];
    }

    const orgSpaces = spaces.length ? spaces : [""];
    for (const space of orgSpaces) {
      targets.push({
        id: buildCfTargetId({ region: region.region, org, space }),
        region: region.region,
        apiEndpoint: region.apiEndpoint,
        org,
        space,
        environment: detectCfEnvironment({ org, space }),
        lastRefreshedAt: now,
      });
    }
  }

  return targets;
}

/**
 * Scan all enabled CF regions and rebuild the cross-region target cache.
 * Failure-safe: a region that fails keeps its previously cached targets and is
 * reported as failed; the scan continues with the remaining regions. The
 * caller's previous CF target is restored at the end.
 */
export async function scanCrossRegionTargets(options: {
  credentials?: TCfScanCredential[];
  regions?: TCfRegionEndpoint[];
  emitEvents?: boolean;
} = {}): Promise<TCfScanSummary> {
  const regions = options.regions ?? (await listEnabledRegions());
  const credentials = options.credentials ?? [];
  const emit = options.emitEvents ?? true;
  const previousTarget = await readCloudFoundryTarget();

  if (emit) {
    emitCacheEvent({
      type: "cache-refresh-started",
      key: "all",
      resource: CROSS_REGION_TARGETS_NAMESPACE,
      detail: { totalRegions: regions.length },
    });
  }

  const regionResults: TCfRegionScanResult[] = [];
  let completedRegions = 0;
  let failedRegions = 0;

  for (const region of regions) {
    if (emit) {
      emitCacheEvent({
        type: "cache-refresh-started",
        key: region.region,
        resource: CROSS_REGION_TARGETS_NAMESPACE,
        detail: { region: region.region, regionStatus: "scanning", totalRegions: regions.length, completedRegions },
      });
    }

    try {
      const targets = await scanRegion(region, credentials);
      await writeEntry(
        CROSS_REGION_TARGETS_NAMESPACE,
        region.region,
        regionEntry({ region: region.region, apiEndpoint: region.apiEndpoint, targets, scanStatus: "success" }),
      );
      completedRegions += 1;
      regionResults.push({ region: region.region, apiEndpoint: region.apiEndpoint, status: "success", targetCount: targets.length, usedCache: false });

      if (emit) {
        emitCacheEvent({
          type: "cache-refresh-success",
          key: region.region,
          resource: CROSS_REGION_TARGETS_NAMESPACE,
          updatedAt: new Date().toISOString(),
          detail: { region: region.region, regionStatus: "success", targetCount: targets.length, totalRegions: regions.length, completedRegions },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedRegions += 1;
      // Keep previously cached targets for this region, mark it failed.
      const previous = await readEntry<TRegionTargetsPayload>(CROSS_REGION_TARGETS_NAMESPACE, region.region);
      const keptTargets = previous?.data.targets ?? [];
      if (previous) {
        previous.refreshState = "failed";
        previous.lastRefreshError = message;
        previous.lastRefreshFinishedAt = new Date().toISOString();
        await writeEntry(CROSS_REGION_TARGETS_NAMESPACE, region.region, previous).catch(() => undefined);
      }
      regionResults.push({ region: region.region, apiEndpoint: region.apiEndpoint, status: "failed", targetCount: keptTargets.length, error: message, usedCache: keptTargets.length > 0 });

      if (emit) {
        emitCacheEvent({
          type: "cache-refresh-failed",
          key: region.region,
          resource: CROSS_REGION_TARGETS_NAMESPACE,
          error: message,
          detail: { region: region.region, regionStatus: "failed", totalRegions: regions.length, completedRegions, failedRegions },
        });
      }
    }
  }

  // Restore the caller's previous target so the scan is side-effect free.
  if (previousTarget.apiEndpoint) {
    await runCommand("cf", ["api", previousTarget.apiEndpoint]);
    if (previousTarget.org) await runCommand("cf", ["target", "-o", previousTarget.org]);
    if (previousTarget.space) await runCommand("cf", ["target", "-s", previousTarget.space]);
  }

  const targets = await listCrossRegionTargets();
  const updatedAt = new Date().toISOString();

  if (emit) {
    emitCacheEvent({
      type: "cache-refresh-success",
      key: "all",
      resource: CROSS_REGION_TARGETS_NAMESPACE,
      updatedAt,
      detail: { totalRegions: regions.length, completedRegions, failedRegions, targetCount: targets.length },
    });
  }

  return { targets, regionResults, totalTargets: targets.length, failedRegions, updatedAt };
}

/** Read all cached cross-region targets (merged across regions). */
export async function listCrossRegionTargets(): Promise<TCfTarget[]> {
  const entries = await readAllEntries<TRegionTargetsPayload>(CROSS_REGION_TARGETS_NAMESPACE);
  const targets: TCfTarget[] = [];
  for (const entry of Object.values(entries)) {
    for (const target of entry.data.targets ?? []) {
      targets.push({ ...target, id: target.id ?? cfTargetKey(target) });
    }
  }
  return targets.sort((left, right) => {
    const byRegion = left.region.localeCompare(right.region);
    if (byRegion !== 0) return byRegion;
    const byOrg = left.org.localeCompare(right.org);
    return byOrg !== 0 ? byOrg : left.space.localeCompare(right.space);
  });
}

/** Per-region status snapshot for the cross-region target cache. */
export async function getCrossRegionStatus(): Promise<{
  totalTargets: number;
  regions: Array<{ region: string; targetCount: number; updatedAt: string; refreshState?: string; scanError?: string }>;
  lastUpdatedAt?: string;
}> {
  const entries = await readAllEntries<TRegionTargetsPayload>(CROSS_REGION_TARGETS_NAMESPACE);
  let total = 0;
  let lastUpdatedAt: string | undefined;
  const regions = Object.values(entries).map((entry) => {
    const count = entry.data.targets?.length ?? 0;
    total += count;
    if (!lastUpdatedAt || entry.updatedAt > lastUpdatedAt) lastUpdatedAt = entry.updatedAt;
    return {
      region: entry.data.region,
      targetCount: count,
      updatedAt: entry.updatedAt,
      refreshState: entry.refreshState,
      scanError: entry.data.scanError ?? entry.lastRefreshError,
    };
  });
  return { totalTargets: total, regions: regions.sort((a, b) => a.region.localeCompare(b.region)), lastUpdatedAt };
}
