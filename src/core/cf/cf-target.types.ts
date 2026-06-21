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

/** Deterministic target id used as the cache key across CLI and Studio. */
export function buildCfTargetId(input: { region: string; org: string; space: string }): string {
  return `${input.region}::${input.org}::${input.space || ""}`;
}

export function cfTargetKey(target: Pick<TCfTarget, "region" | "org" | "space">): string {
  return buildCfTargetId(target);
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
