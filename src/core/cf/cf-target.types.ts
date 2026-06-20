export type TCfTarget = {
  region: string;
  apiEndpoint: string;
  org: string;
  space: string;
  isFavorite?: boolean;
  lastUsedAt?: string;
  lastRefreshedAt?: string;
};

export function cfTargetKey(target: Pick<TCfTarget, "region" | "org" | "space">): string {
  return `${target.region}::${target.org}::${target.space || ""}`;
}

export function cfTargetLabel(target: Pick<TCfTarget, "region" | "org" | "space">): string {
  return `${target.region} / ${target.org}${target.space ? ` / ${target.space}` : ""}`;
}
