import { listRegions } from "./cf-region-registry";
import { listCrossRegionTargets } from "./cf-cross-region-scanner";
import { listFavoriteTargets, listRecentTargets } from "./cf-target-cache";
import { cfExecutionService } from "./cf-execution-service";
import type { TCfExecutionContext } from "./cf-execution-service";
import { cfTargetKey } from "./cf-target.types";
import type { TCfTarget } from "./cf-target.types";

export type TCfTargetKeyParts = { region: string; org: string; space: string };

/** Deterministic target-key parser: `region::org::space`. All three parts must be non-empty. */
export function parseCfTargetKey(targetKey: string): TCfTargetKeyParts {
  const parts = (targetKey ?? "").split("::");
  if (parts.length !== 3) {
    throw new Error(`Invalid CF target key format: ${targetKey}. Expected region::org::space`);
  }
  const [region, org, space] = parts;
  if (!region?.trim() || !org?.trim() || !space?.trim()) {
    throw new Error(
      `Invalid CF target key: ${targetKey}. All three parts (region, org, space) must be non-empty.`,
    );
  }
  return { region: region.trim(), org: org.trim(), space: space.trim() };
}

/** Resolve the API endpoint for a region name from the region registry. */
async function resolveApiEndpointForRegion(region: string): Promise<string | undefined> {
  const regions = await listRegions();
  return regions.find((item) => item.region === region)?.apiEndpoint;
}

/**
 * Find the full target object (with apiEndpoint) for a target key. Looks in the
 * cross-region cache first, then favorites/recent, and finally derives the
 * apiEndpoint from the region registry. Never silently falls back to a different
 * target — returns undefined when nothing usable is found.
 */
export async function findTargetByKey(targetKey: string): Promise<TCfTarget | undefined> {
  const parts = parseCfTargetKey(targetKey);

  const fromCrossRegion = (await listCrossRegionTargets()).find((target) => cfTargetKey(target) === targetKey);
  if (fromCrossRegion?.apiEndpoint) {
    return fromCrossRegion;
  }

  const fromFavorites = (await listFavoriteTargets()).find((target) => cfTargetKey(target) === targetKey);
  if (fromFavorites?.apiEndpoint) {
    return fromFavorites;
  }

  const fromRecent = (await listRecentTargets(100)).find((target) => cfTargetKey(target) === targetKey);
  if (fromRecent?.apiEndpoint) {
    return fromRecent;
  }

  // Derive apiEndpoint from the region registry as a last resort.
  const apiEndpoint = await resolveApiEndpointForRegion(parts.region);
  if (apiEndpoint) {
    return { region: parts.region, apiEndpoint, org: parts.org, space: parts.space };
  }

  // We at least know region/org/space but cannot resolve an endpoint.
  return fromCrossRegion ?? fromFavorites ?? fromRecent;
}

/**
 * Run `action` in the context of the given target key. Delegates to the CF
 * execution service, which uses an isolated per-region CF_HOME and a per-region
 * mutex — so this never disturbs the developer's global `cf target` and
 * concurrent Studio/background calls cannot corrupt each other's session.
 *
 * The action receives the execution context (with the isolated CF_HOME) and the
 * resolved target. Run CF commands via `context` (e.g. cfExecutionService.runCf)
 * so they execute against the correct isolated session.
 */
export function withCfTarget<T>(
  targetKey: string,
  action: (context: TCfExecutionContext, target: TCfTarget) => Promise<T>,
): Promise<T> {
  return cfExecutionService.withCfTarget(targetKey, action);
}

/**
 * Ensure an authenticated session for a target's region using the isolated
 * CF_HOME. Kept for backward compatibility; prefer `withCfTarget`.
 */
export async function ensureCfLoggedInForRegion(target: TCfTarget): Promise<void> {
  await cfExecutionService.runInRegion(target.region, target.apiEndpoint, async () => undefined);
}
