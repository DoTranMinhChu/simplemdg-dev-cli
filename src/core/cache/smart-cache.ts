export * from "./smart-cache.types";
export { smartRead, refreshCache, computeCacheStatus, isRefreshPending } from "./smart-cache-manager";
export { onCacheEvent, emitCacheEvent } from "./smart-cache-events";
export {
  clearNamespace,
  statNamespace,
  removeEntry,
  readEntry,
  writeEntry,
  getCacheDirectory,
} from "./smart-cache-store";

/** Known cache namespaces with human labels (also drives `smdg cache status`). */
export const CACHE_NAMESPACES: Record<string, string> = {
  "cf-regions": "CF regions",
  "cf-targets": "CF targets",
  "cf-orgs": "CF orgs",
  "cf-spaces": "CF spaces",
  "cf-apps": "CF apps",
  "cf-env": "CF env (parsed, non-secret)",
  "db-import-candidates": "DB import candidates",
  "db-metadata": "DB metadata",
  "gitlab-groups": "GitLab groups",
  "gitlab-projects": "GitLab projects",
  "gitlab-branches": "GitLab branches",
  "object-type-discovery": "Tool Studio object-type discovery",
  "object-type-suggestions": "Tool Studio object-type cds/consolidation suggestions",
  "cf-recent-targets": "CF recent targets",
  "cf-favorite-targets": "CF favorite targets",
};

/** Namespace groups for `smdg cache clear|refresh <scope>`. */
export const CACHE_SCOPES: Record<string, string[]> = {
  cf: ["cf-regions", "cf-targets", "cf-orgs", "cf-spaces", "cf-apps", "cf-env"],
  gitlab: ["gitlab-groups", "gitlab-projects", "gitlab-branches"],
  db: ["db-import-candidates", "db-metadata"],
  target: ["cf-targets", "cf-recent-targets", "cf-favorite-targets"],
  tool: ["object-type-discovery", "object-type-suggestions"],
  all: Object.keys(CACHE_NAMESPACES),
};

function sanitize(value: string | undefined): string {
  return (value ?? "").trim().replace(/::/g, ":") || "_";
}

export function buildCfRegionKey(region: string): string {
  return sanitize(region);
}

export function buildCfOrgKey(region: string): string {
  return sanitize(region);
}

export function buildCfSpaceKey(region: string, org: string): string {
  return `${sanitize(region)}::${sanitize(org)}`;
}

export function buildCfTargetKey(region: string, org: string, space: string): string {
  return `${sanitize(region)}::${sanitize(org)}::${sanitize(space)}`;
}

export function buildCfAppsKey(region: string, org: string, space: string): string {
  return buildCfTargetKey(region, org, space);
}

export function buildCfEnvKey(region: string, org: string, space: string, appName: string): string {
  return `${buildCfTargetKey(region, org, space)}::${sanitize(appName)}`;
}

export function buildDbImportCandidatesKey(region: string, org: string, space: string, appName: string): string {
  return buildCfEnvKey(region, org, space, appName);
}

export function buildGitLabGroupsKey(baseUrl: string, userId?: string | number): string {
  return `${sanitize(baseUrl)}::${sanitize(userId === undefined ? "" : String(userId))}`;
}

export function buildGitLabProjectsKey(baseUrl: string, groupId: string | number): string {
  return `${sanitize(baseUrl)}::${sanitize(String(groupId))}`;
}

export function buildGitLabBranchesKey(baseUrl: string, projectId: string | number): string {
  return `${sanitize(baseUrl)}::${sanitize(String(projectId))}`;
}

export function formatRelativeTime(iso: string | undefined): string {
  if (!iso) {
    return "never";
  }

  const deltaMs = Date.now() - new Date(iso).getTime();

  if (deltaMs < 0) {
    return "just now";
  }

  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
