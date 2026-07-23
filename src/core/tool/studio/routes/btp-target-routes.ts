import http from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getCfAuthStatus, loginCfWithPassword, cfLogout } from "../../../cf/cf-auth-service";
import { listRegions } from "../../../cf/cf-region-registry";
import { listFavoriteTargets, listRecentTargets, addFavoriteTarget, removeFavoriteTarget, addRecentTarget } from "../../../cf/cf-target-cache";
import { cfTargetKey, isValidCfTarget } from "../../../cf/cf-target.types";
import type { TCfTarget } from "../../../cf/cf-target.types";
import { listCrossRegionTargets, listCrossRegionOrgSummaries, getCrossRegionStatus, scanCrossRegionTargets } from "../../../cf/cf-cross-region-scanner";
import type { TCfScanCredential } from "../../../cf/cf-cross-region-scanner";
import { withCfTarget, parseCfTargetKey } from "../../../cf/cf-target-switcher";
import { listAppsInContext } from "../../../db/db-btp";
import { onCacheEvent, formatRelativeTime, computeCacheStatus, refreshCache, DEFAULT_CACHE_TTL } from "../../../cache/smart-cache";
import { readAllEntries, readEntry } from "../../../cache/smart-cache-store";
import { readCache } from "../../../cache";
import type { TSmartCacheEntry } from "../../../cache/smart-cache.types";

/**
 * The CF/BTP target-and-app picker (`BtpTargetSelector`/`BtpAppSelector`/
 * `CfLoginModal`) is a shared React component reused verbatim across DB
 * Studio and Tool Studio — but each Studio is served by its OWN local HTTP
 * server/port, so the same `/api/cf/*` + `/api/btp/*` paths the component
 * calls must resolve on THIS server too, not just DB Studio's. This mirrors
 * (intentionally not de-duplicates, to avoid touching DB Studio's
 * already-shipped router) `db-studio-server.ts`'s equivalent routes.
 */

export function detectEnvironment(org: string, space: string): string {
  const haystack = `${org} ${space}`.toLowerCase();
  if (/\bprod\b|production|prd|\blive\b/.test(haystack)) return "PROD";
  if (/\bqas\b|quality|staging|uat/.test(haystack)) return "QAS";
  if (/\bdev\b|development|\blocal\b/.test(haystack)) return "DEV";
  if (/\bsandbox\b|sbx/.test(haystack)) return "SANDBOX";
  return "";
}

function buildTargetSummary(target: TCfTarget, appsEntry?: TSmartCacheEntry<unknown[]> | undefined): Record<string, unknown> {
  const env = detectEnvironment(target.org, target.space);
  const cacheStatus = appsEntry ? computeCacheStatus(appsEntry) : "missing";
  const appCount = appsEntry ? (Array.isArray(appsEntry.data) ? appsEntry.data.length : 0) : undefined;
  return {
    region: target.region,
    apiEndpoint: target.apiEndpoint,
    org: target.org,
    space: target.space,
    key: cfTargetKey(target),
    isFavorite: target.isFavorite ?? false,
    lastUsedAt: target.lastUsedAt,
    environment: env,
    cachedAppCount: appCount,
    cacheStatus,
    updatedAt: appsEntry?.updatedAt,
    updatedAgo: formatRelativeTime(appsEntry?.updatedAt),
  };
}

async function resolveCfScanCredentials(): Promise<TCfScanCredential[]> {
  const cache = await readCache();
  return cache.cloudFoundry.loginProfiles.map((profile) => ({
    apiEndpoint: profile.apiEndpoint,
    username: profile.username,
    password: profile.password,
  }));
}

/**
 * Every CF org/space this process knows about from any source — favorites, recents, the
 * cross-region `cf orgs`/`cf spaces` scan, and any target merely implied by a cached `cf-apps`
 * entry (visited before favorites/recents/scanning existed, or scanning is disabled/failed for
 * that region). Shared by `/api/btp/targets` (this file) and Check API External's merged
 * server picker (check-api-routes.ts), which needs the same target universe to cross-reference
 * against cached apps without duplicating this dedup logic.
 */
export async function resolveAllKnownCfTargets(): Promise<{ targets: TCfTarget[]; favoriteKeys: Set<string> }> {
  const favTargets = await listFavoriteTargets();
  const recentTargets = await listRecentTargets(10);
  const appsEntries = await readAllEntries<unknown[]>("cf-apps");
  const favoriteKeys = new Set(favTargets.map((t) => cfTargetKey(t)));
  const crossRegion = await listCrossRegionTargets();

  const allFromApps: TCfTarget[] = [];
  for (const key of Object.keys(appsEntries)) {
    const parts = key.split("::");
    if (parts.length === 3 && parts[0]?.trim() && parts[1]?.trim() && parts[2]?.trim()) {
      allFromApps.push({ region: parts[0], apiEndpoint: "", org: parts[1], space: parts[2] });
    }
  }

  const targetMap = new Map<string, TCfTarget>();
  for (const t of [...crossRegion, ...favTargets, ...recentTargets, ...allFromApps]) {
    if (!isValidCfTarget(t)) continue;
    const k = cfTargetKey(t);
    if (!targetMap.has(k)) targetMap.set(k, t);
  }
  return { targets: Array.from(targetMap.values()), favoriteKeys };
}

export async function handleBtpTargetApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  const pathname = url.pathname;

  if (pathname === "/api/cf/auth-status" && method === "GET") {
    sendJson(res, await getCfAuthStatus());
    return true;
  }

  if (pathname === "/api/cf/login" && method === "POST") {
    const body = await readJsonBody(req);
    const result = await loginCfWithPassword({
      apiEndpoint: getString(body, "apiEndpoint"),
      region: getString(body, "region") || undefined,
      username: getString(body, "username"),
      password: getString(body, "password"),
      remember: body.remember !== false,
    });
    if (result.success) {
      void scanCrossRegionTargets({ credentials: await resolveCfScanCredentials() }).catch(() => undefined);
    }
    sendJson(res, result);
    return true;
  }

  if (pathname === "/api/cf/logout" && method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, await cfLogout({ clearCachedCredentials: body.clearCachedCredentials === true }));
    return true;
  }

  if (pathname === "/api/cf/regions" && method === "GET") {
    const regions = await listRegions();
    sendJson(res, { regions: regions.filter((r) => r.enabled || r.isCustom) });
    return true;
  }

  if (pathname === "/api/btp/targets" && method === "GET") {
    const favTargets = await listFavoriteTargets();
    const recentTargets = await listRecentTargets(10);
    const appsEntries = await readAllEntries<unknown[]>("cf-apps");

    const { targets: allTargets, favoriteKeys: favKeys } = await resolveAllKnownCfTargets();
    const orgSummaries = await listCrossRegionOrgSummaries();

    const byRegion: Record<string, unknown[]> = {};
    for (const t of allTargets) {
      if (!byRegion[t.region]) byRegion[t.region] = [];
      const appsEntry = appsEntries[cfTargetKey(t)] as TSmartCacheEntry<unknown[]> | undefined;
      byRegion[t.region].push(buildTargetSummary({ ...t, isFavorite: favKeys.has(cfTargetKey(t)) }, appsEntry));
    }

    const noSpaceByRegion: Record<string, Array<{ org: string; status: string; error?: string }>> = {};
    for (const summary of orgSummaries) {
      if (summary.status !== "spaces-loaded") {
        if (!noSpaceByRegion[summary.region]) noSpaceByRegion[summary.region] = [];
        noSpaceByRegion[summary.region].push({ org: summary.org, status: summary.status, error: summary.error });
      }
    }

    const regionStatus = await getCrossRegionStatus();
    sendJson(res, {
      favorites: favTargets.map((t) => buildTargetSummary(t, appsEntries[cfTargetKey(t)] as TSmartCacheEntry<unknown[]> | undefined)),
      recent: recentTargets.map((t) => buildTargetSummary(t, appsEntries[cfTargetKey(t)] as TSmartCacheEntry<unknown[]> | undefined)),
      byRegion,
      noSpaceByRegion,
      totalTargets: allTargets.length,
      regions: Object.keys(byRegion).sort(),
      regionStatus: regionStatus.regions,
      lastUpdatedAt: regionStatus.lastUpdatedAt,
      lastUpdatedAgo: formatRelativeTime(regionStatus.lastUpdatedAt),
    });
    return true;
  }

  if (pathname === "/api/btp/targets/refresh" && method === "POST") {
    void scanCrossRegionTargets({ credentials: await resolveCfScanCredentials() }).catch(() => undefined);
    sendJson(res, { ok: true, started: true });
    return true;
  }

  if (pathname === "/api/btp/apps" && method === "GET") {
    const targetKey = url.searchParams.get("targetKey") ?? "";
    const forceRefresh = url.searchParams.get("refresh") === "true";
    if (!targetKey) {
      sendJson(res, { apps: [], cacheStatus: "missing", error: "targetKey required" });
      return true;
    }

    let parts: { region: string; org: string; space: string };
    try {
      parts = parseCfTargetKey(targetKey);
    } catch (error) {
      sendJson(res, { apps: [], cacheStatus: "missing", error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const targetCtx = { region: parts.region, org: parts.org, space: parts.space };

    const entry = await readEntry<unknown[]>("cf-apps", targetKey);
    const cacheStatus = entry ? computeCacheStatus(entry) : "missing";
    const fetchApps = () => withCfTarget(targetKey, (context) => listAppsInContext(context));

    if (entry && !forceRefresh) {
      const refreshPromise = refreshCache({ namespace: "cf-apps", key: targetKey, ttlMs: DEFAULT_CACHE_TTL.cfApps, resource: "cf-apps", fetcher: fetchApps });
      refreshPromise.catch(() => undefined);
      sendJson(res, { targetKey, target: targetCtx, apps: entry.data, cacheStatus, fromCache: true, isRefreshing: true, updatedAt: entry.updatedAt, updatedAgo: formatRelativeTime(entry.updatedAt) });
      return true;
    }

    try {
      const apps = await refreshCache({ namespace: "cf-apps", key: targetKey, ttlMs: DEFAULT_CACHE_TTL.cfApps, resource: "cf-apps", fetcher: fetchApps });
      sendJson(res, { targetKey, target: targetCtx, apps, cacheStatus: "fresh", fromCache: false, isRefreshing: false, updatedAt: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (entry) {
        sendJson(res, { targetKey, target: targetCtx, apps: entry.data, cacheStatus: "stale", fromCache: true, isRefreshing: false, updatedAt: entry.updatedAt, updatedAgo: formatRelativeTime(entry.updatedAt), warning: `Refresh failed; showing cached apps. ${message}` });
      } else {
        sendJson(res, { targetKey, target: targetCtx, apps: [], cacheStatus: "missing", fromCache: false, isRefreshing: false, error: message });
      }
    }
    return true;
  }

  if (pathname === "/api/btp/favorite" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const add = body.add !== false;
    const parts = targetKey.split("::");
    const target: TCfTarget = { region: parts[0] ?? "", apiEndpoint: "", org: parts[1] ?? "", space: parts[2] ?? "" };
    if (add) await addFavoriteTarget(target);
    else await removeFavoriteTarget(target);
    sendJson(res, { ok: true });
    return true;
  }

  if (pathname === "/api/btp/recent" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const parts = targetKey.split("::");
    const target: TCfTarget = { region: parts[0] ?? "", apiEndpoint: "", org: parts[1] ?? "", space: parts[2] ?? "" };
    await addRecentTarget(target);
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}

/** Re-exported so tool-studio-server.ts's SSE endpoint can forward cache-refresh events too (same event bus DB Studio uses). */
export { onCacheEvent };
