import { parseCloudFoundryNameList } from "../cf";
import { emitCacheEvent } from "../cache/smart-cache-events";
import { readAllEntries, readEntry, writeEntry } from "../cache/smart-cache-store";
import { listEnabledRegions } from "./cf-region-registry";
import type { TCfRegionEndpoint } from "./cf-region-registry";
import { cfExecutionService } from "./cf-execution-service";
import type { TCfExecutionContext } from "./cf-execution-service";
import { buildCfTargetId, cfTargetKey, detectCfEnvironment, isValidCfTarget } from "./cf-target.types";
import type { TCfTarget, TCfOrgSummary } from "./cf-target.types";
import type { TSmartCacheEntry } from "../cache/smart-cache.types";
import { DEFAULT_CACHE_TTL } from "../cache/smart-cache.types";

export const CROSS_REGION_TARGETS_NAMESPACE = "cf-cross-region-targets";

export type TCfScanCredential = { apiEndpoint: string; username: string; password?: string };

/** Per-region scan result stored under the cross-region targets namespace. */
type TRegionTargetsPayload = {
  region: string;
  apiEndpoint: string;
  targets: TCfTarget[];
  /** Orgs that were found but had no accessible spaces, or whose space-load failed. */
  orgSummaries: TCfOrgSummary[];
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

/**
 * Scan a single region for org/space targets. Runs entirely inside the region's
 * isolated CF_HOME (via the execution service), which also handles `cf api` and
 * silent auto re-login. Never touches the developer's global `cf target`.
 */
async function scanRegion(
  region: TCfRegionEndpoint,
): Promise<{ targets: TCfTarget[]; orgSummaries: TCfOrgSummary[] }> {
  return cfExecutionService.runInRegion(region.region, region.apiEndpoint, async (context: TCfExecutionContext) => {
    const orgsResult = await cfExecutionService.runCf(context, ["orgs"], { silent: true });
    if (orgsResult.exitCode !== 0) {
      throw new Error(`Cannot list orgs for ${region.region}: ${(orgsResult.stderr || orgsResult.stdout || "").trim()}`);
    }
    const orgs = parseCloudFoundryNameList(orgsResult.stdout, "name");

    const now = new Date().toISOString();
    const targets: TCfTarget[] = [];
    const orgSummaries: TCfOrgSummary[] = [];

    for (const org of orgs) {
      // Target the org first; if that fails the org is inaccessible.
      const orgTarget = await cfExecutionService.runCf(context, ["target", "-o", org], { silent: true });
      if (orgTarget.exitCode !== 0) {
        orgSummaries.push({
          region: region.region,
          apiEndpoint: region.apiEndpoint,
          org,
          status: "spaces-failed",
          error: orgTarget.stderr || orgTarget.stdout || "cf target failed",
        });
        continue;
      }

      const spacesResult = await cfExecutionService.runCf(context, ["spaces"], { silent: true });
      if (spacesResult.exitCode !== 0) {
        orgSummaries.push({
          region: region.region,
          apiEndpoint: region.apiEndpoint,
          org,
          status: "spaces-failed",
          error: spacesResult.stderr || spacesResult.stdout || "cf spaces failed",
        });
        continue;
      }

      const spaces = parseCloudFoundryNameList(spacesResult.stdout, "name");

      if (!spaces.length) {
        // Org exists but has no spaces — not a usable CF target.
        orgSummaries.push({
          region: region.region,
          apiEndpoint: region.apiEndpoint,
          org,
          spaceCount: 0,
          status: "no-spaces",
        });
        continue;
      }

      orgSummaries.push({
        region: region.region,
        apiEndpoint: region.apiEndpoint,
        org,
        spaceCount: spaces.length,
        status: "spaces-loaded",
      });

      for (const space of spaces) {
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

    return { targets, orgSummaries };
  });
}

/**
 * Scan all enabled CF regions and rebuild the cross-region target cache.
 * Regions are scanned in parallel — each in its own isolated CF_HOME and serialized
 * by its per-region mutex — so they never corrupt each other's session. A region
 * that fails keeps its previously cached targets, is reported as failed, and does
 * not break the others. The developer's global `cf target` is never touched.
 */
export async function scanCrossRegionTargets(options: {
  credentials?: TCfScanCredential[];
  regions?: TCfRegionEndpoint[];
  emitEvents?: boolean;
} = {}): Promise<TCfScanSummary> {
  const regions = options.regions ?? (await listEnabledRegions());
  const emit = options.emitEvents ?? true;

  if (emit) {
    emitCacheEvent({
      type: "cache-refresh-started",
      key: "all",
      resource: CROSS_REGION_TARGETS_NAMESPACE,
      detail: { totalRegions: regions.length },
    });
  }

  let completedRegions = 0;
  let failedRegions = 0;

  const scanOne = async (region: TCfRegionEndpoint): Promise<TCfRegionScanResult> => {
    if (emit) {
      emitCacheEvent({
        type: "cache-refresh-started",
        key: region.region,
        resource: CROSS_REGION_TARGETS_NAMESPACE,
        detail: { region: region.region, regionStatus: "scanning", totalRegions: regions.length, completedRegions },
      });
    }

    try {
      const { targets, orgSummaries } = await scanRegion(region);
      await writeEntry(
        CROSS_REGION_TARGETS_NAMESPACE,
        region.region,
        regionEntry({ region: region.region, apiEndpoint: region.apiEndpoint, targets, orgSummaries, scanStatus: "success" }),
      );
      completedRegions += 1;

      if (emit) {
        emitCacheEvent({
          type: "cache-refresh-success",
          key: region.region,
          resource: CROSS_REGION_TARGETS_NAMESPACE,
          updatedAt: new Date().toISOString(),
          detail: { region: region.region, regionStatus: "success", targetCount: targets.length, totalRegions: regions.length, completedRegions },
        });
      }

      return { region: region.region, apiEndpoint: region.apiEndpoint, status: "success", targetCount: targets.length, usedCache: false };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedRegions += 1;
      // Keep previously cached targets for this region, mark it failed. Never
      // overwrite good cached targets with an empty/failed result.
      const previous = await readEntry<TRegionTargetsPayload>(CROSS_REGION_TARGETS_NAMESPACE, region.region);
      const keptTargets = previous?.data.targets ?? [];
      if (previous) {
        previous.refreshState = "failed";
        previous.lastRefreshError = message;
        previous.lastRefreshFinishedAt = new Date().toISOString();
        await writeEntry(CROSS_REGION_TARGETS_NAMESPACE, region.region, previous).catch(() => undefined);
      }

      if (emit) {
        emitCacheEvent({
          type: "cache-refresh-failed",
          key: region.region,
          resource: CROSS_REGION_TARGETS_NAMESPACE,
          error: message,
          detail: { region: region.region, regionStatus: "failed", totalRegions: regions.length, completedRegions, failedRegions },
        });
      }

      return { region: region.region, apiEndpoint: region.apiEndpoint, status: "failed", targetCount: keptTargets.length, error: message, usedCache: keptTargets.length > 0 };
    }
  };

  const regionResults = await Promise.all(regions.map((region) => scanOne(region)));

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

/** Read all cached cross-region targets (merged across regions). Skips invalid (empty-space) entries. */
export async function listCrossRegionTargets(): Promise<TCfTarget[]> {
  const entries = await readAllEntries<TRegionTargetsPayload>(CROSS_REGION_TARGETS_NAMESPACE);
  const targets: TCfTarget[] = [];
  for (const entry of Object.values(entries)) {
    for (const target of entry.data.targets ?? []) {
      if (!isValidCfTarget(target)) continue;
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

/** Read all org summaries (orgs with no spaces or failed space-load) across regions. */
export async function listCrossRegionOrgSummaries(): Promise<TCfOrgSummary[]> {
  const entries = await readAllEntries<TRegionTargetsPayload>(CROSS_REGION_TARGETS_NAMESPACE);
  const summaries: TCfOrgSummary[] = [];
  for (const entry of Object.values(entries)) {
    for (const summary of entry.data.orgSummaries ?? []) {
      summaries.push(summary);
    }
  }
  return summaries.sort((a, b) => {
    const byRegion = a.region.localeCompare(b.region);
    return byRegion !== 0 ? byRegion : a.org.localeCompare(b.org);
  });
}

/** Per-region status snapshot for the cross-region target cache. */
export async function getCrossRegionStatus(): Promise<{
  totalTargets: number;
  regions: Array<{
    region: string;
    targetCount: number;
    noSpaceOrgCount: number;
    failedSpaceOrgCount: number;
    updatedAt: string;
    refreshState?: string;
    scanError?: string;
  }>;
  lastUpdatedAt?: string;
}> {
  const entries = await readAllEntries<TRegionTargetsPayload>(CROSS_REGION_TARGETS_NAMESPACE);
  let total = 0;
  let lastUpdatedAt: string | undefined;
  const regions = Object.values(entries).map((entry) => {
    const validTargets = (entry.data.targets ?? []).filter(isValidCfTarget);
    const count = validTargets.length;
    total += count;
    const orgSummaries = entry.data.orgSummaries ?? [];
    const noSpaceOrgCount = orgSummaries.filter((s) => s.status === "no-spaces").length;
    const failedSpaceOrgCount = orgSummaries.filter((s) => s.status === "spaces-failed").length;
    if (!lastUpdatedAt || entry.updatedAt > lastUpdatedAt) lastUpdatedAt = entry.updatedAt;
    return {
      region: entry.data.region,
      targetCount: count,
      noSpaceOrgCount,
      failedSpaceOrgCount,
      updatedAt: entry.updatedAt,
      refreshState: entry.refreshState,
      scanError: entry.data.scanError ?? entry.lastRefreshError,
    };
  });
  return { totalTargets: total, regions: regions.sort((a, b) => a.region.localeCompare(b.region)), lastUpdatedAt };
}
