export type TCfEnvironmentTag =
  | "DEV"
  | "QAS"
  | "PROD"
  | "SANDBOX"
  | "POC"
  | "UAT"
  | "STAGING"
  | "UNKNOWN";

export type TCfTarget = {
  /** Deterministic id: `${region}::${org}::${space}` (see buildCfTargetId). */
  id?: string;
  region: string;
  apiEndpoint: string;
  org: string;
  space: string;
  environment?: TCfEnvironmentTag;
  isFavorite?: boolean;
  lastUsedAt?: string;
  lastRefreshedAt?: string;
  cachedAppCount?: number;
  cacheStatus?: "fresh" | "stale" | "expired" | "missing";
  refreshState?: "idle" | "refreshing" | "failed";
};

/**
 * An org that was discovered during scanning but has no accessible spaces
 * (or space loading failed), so it cannot be a selectable CF target.
 */
export type TCfOrgSummary = {
  region: string;
  apiEndpoint: string;
  org: string;
  spaceCount?: number;
  status: "spaces-loaded" | "no-spaces" | "spaces-failed";
  error?: string;
};

/**
 * Deterministic target id. Throws if any field is blank — an empty space
 * would produce an invalid key like `br10::org::` which cannot be used.
 */
export function buildCfTargetId(input: { region: string; org: string; space: string }): string {
  if (!input.region?.trim()) throw new Error("CF target region is required.");
  if (!input.org?.trim()) throw new Error("CF target org is required.");
  if (!input.space?.trim()) throw new Error("CF target space is required.");
  return `${input.region.trim()}::${input.org.trim()}::${input.space.trim()}`;
}

export function cfTargetKey(target: Pick<TCfTarget, "region" | "org" | "space">): string {
  return buildCfTargetId(target);
}

/** True only when region, org, and space are all non-empty. */
export function isValidCfTarget(target: Pick<TCfTarget, "region" | "org" | "space">): boolean {
  return Boolean(target.region?.trim() && target.org?.trim() && target.space?.trim());
}

export function cfTargetLabel(target: Pick<TCfTarget, "region" | "org" | "space">): string {
  return `${target.region} / ${target.org}${target.space ? ` / ${target.space}` : ""}`;
}

/** Best-effort environment classification from org/space naming conventions. */
export function detectCfEnvironment(target: Pick<TCfTarget, "org" | "space">): TCfEnvironmentTag {
  const haystack = `${target.org} ${target.space}`.toLowerCase();
  if (/\bprod\b|production|\bprd\b|\blive\b/.test(haystack)) return "PROD";
  if (/\bstag(e|ing)\b/.test(haystack)) return "STAGING";
  if (/\bqas\b|quality|\bqa\b/.test(haystack)) return "QAS";
  if (/\buat\b/.test(haystack)) return "UAT";
  if (/\bpoc\b/.test(haystack)) return "POC";
  if (/\bsandbox\b|\bsbx\b/.test(haystack)) return "SANDBOX";
  if (/\bdev\b|development/.test(haystack)) return "DEV";
  return "UNKNOWN";
}
