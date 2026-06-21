import {
  authenticateCloudFoundry,
  inferCloudFoundryRegionFromApiEndpoint,
  readCloudFoundryTarget,
  setCloudFoundryApiEndpoint,
  targetCloudFoundryOrg,
  targetCloudFoundrySpace,
} from "../cf";
import { runCommand } from "../process";
import { readCache } from "../cache";
import { listRegions } from "./cf-region-registry";
import { listCrossRegionTargets } from "./cf-cross-region-scanner";
import { listFavoriteTargets, listRecentTargets } from "./cf-target-cache";
import { cfTargetKey } from "./cf-target.types";
import type { TCfTarget } from "./cf-target.types";
import type { TCloudFoundryLoginProfile, TCloudFoundryTarget } from "../types";

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
 * Point the CF CLI at the target's region and ensure an authenticated session,
 * auto re-logging in from cached credentials when needed. Never prompts; throws
 * a clear, actionable error when no cached credentials work.
 */
export async function ensureCfLoggedInForRegion(target: TCfTarget): Promise<void> {
  const region = inferCloudFoundryRegionFromApiEndpoint(target.apiEndpoint);

  const apiExitCode = await setCloudFoundryApiEndpoint(target.apiEndpoint);
  if (apiExitCode !== 0) {
    throw new Error(`Cannot set CF API endpoint: ${target.apiEndpoint}`);
  }

  // Already authenticated for this region?
  const orgsCheck = await runCommand("cf", ["orgs"]);
  if (orgsCheck.exitCode === 0) {
    return;
  }

  const cache = await readCache();
  const profiles = sortProfilesForTarget(cache.cloudFoundry.loginProfiles, target);

  if (!profiles.length) {
    throw new Error(`Cloud Foundry login is required for ${region}. Run: smdg cf login`);
  }

  let lastError = orgsCheck.stderr || orgsCheck.stdout || "cf orgs failed";

  for (const profile of profiles) {
    const authExitCode = await authenticateCloudFoundry({
      username: profile.username,
      password: profile.password as string,
    });

    if (authExitCode !== 0) {
      lastError = `cf auth failed for ${profile.username}`;
      continue;
    }

    const recheck = await runCommand("cf", ["orgs"]);
    if (recheck.exitCode === 0) {
      return;
    }
    lastError = recheck.stderr || recheck.stdout || lastError;
  }

  throw new Error(`CF automatic login failed for ${region}. ${lastError}. Run smdg cf login and update the cached password.`);
}

function sortProfilesForTarget(profiles: TCloudFoundryLoginProfile[], target: TCfTarget): TCloudFoundryLoginProfile[] {
  const withPassword = profiles.filter((profile) => profile.password?.trim());
  return [
    ...withPassword.filter((profile) => profile.apiEndpoint === target.apiEndpoint && profile.org === target.org),
    ...withPassword.filter((profile) => profile.apiEndpoint === target.apiEndpoint && profile.org !== target.org),
    ...withPassword.filter((profile) => profile.apiEndpoint !== target.apiEndpoint),
  ].filter((profile, index, array) => array.indexOf(profile) === index);
}

async function restorePreviousTarget(previous: TCloudFoundryTarget): Promise<void> {
  if (!previous.apiEndpoint) {
    return;
  }
  await setCloudFoundryApiEndpoint(previous.apiEndpoint);
  if (previous.org) {
    await targetCloudFoundryOrg(previous.org);
  }
  if (previous.space) {
    await targetCloudFoundrySpace(previous.space);
  }
}

// Switching the CF target mutates process-wide CF config, so serialize all
// withCfTarget calls to avoid concurrent requests clobbering each other.
let cfTargetLock: Promise<unknown> = Promise.resolve();

/**
 * Run `action` in the context of the given target key: switch CF api/org/space
 * (auto re-login from cache), execute, then restore the caller's previous CF
 * target. Calls are serialized to prevent concurrent target switches.
 */
export function withCfTarget<T>(targetKey: string, action: (target: TCfTarget) => Promise<T>): Promise<T> {
  const run = cfTargetLock.then(
    () => runWithCfTarget(targetKey, action),
    () => runWithCfTarget(targetKey, action),
  );
  // Keep the lock chain alive regardless of this call's outcome.
  cfTargetLock = run.then(() => undefined, () => undefined);
  return run;
}

async function runWithCfTarget<T>(targetKey: string, action: (target: TCfTarget) => Promise<T>): Promise<T> {
  const parts = parseCfTargetKey(targetKey);
  const target = await findTargetByKey(targetKey);

  if (!target || !target.apiEndpoint) {
    throw new Error(`Target ${parts.region} / ${parts.org} / ${parts.space} not found in cache. Refresh cross-region targets first (smdg cf org --refresh).`);
  }

  const previous = await readCloudFoundryTarget();

  await ensureCfLoggedInForRegion(target);

  const orgExitCode = await targetCloudFoundryOrg(target.org);
  if (orgExitCode !== 0) {
    throw new Error(`Cannot target CF org ${target.org} in ${target.region}.`);
  }

  if (target.space) {
    const spaceExitCode = await targetCloudFoundrySpace(target.space);
    if (spaceExitCode !== 0) {
      throw new Error(`Cannot target CF space ${target.space} in org ${target.org}.`);
    }
  }

  try {
    return await action(target);
  } finally {
    // Restore is best-effort; failure must not hide the action result/error.
    await restorePreviousTarget(previous).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Warning: could not restore previous CF target: ${message}`);
    });
  }
}
