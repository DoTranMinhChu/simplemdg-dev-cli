import type { TNexusRepoStats, TNexusRepoSummary } from "./nexus-types";

export type TNexusOverview = {
  branch?: string;
  indexedAt?: string;
  upToDate?: boolean;
  stats?: TNexusRepoStats;
};

/**
 * Project Overview is deliberately stats-first rather than an auto-categorized
 * breakdown (main areas / APIs / DB entities / etc.) — spiking GitNexus's
 * Cypher schema for those categories (community/entity node shapes) did not
 * turn up a verified query, and the product principle here is "never show a
 * finding we can't back with real data." Repo-level stats (files, symbols,
 * relationships, clusters, execution flows) ARE fully verified (`gitnexus
 * list`/`status`), so this stays a small, honest summary that points the user
 * at Search/Execution Flow Explorer for anything more specific.
 *
 * Deliberately synchronous (no GitNexus call of its own): everything here —
 * branch, indexedAt, freshness, stats — was ALREADY computed by
 * `listAnalyzedRepos()`/`findAnalyzedRepo()` when the caller resolved the
 * repo in the first place. An earlier version re-fetched freshness via a
 * fresh `gitnexus status` CLI spawn here too — confirmed during
 * implementation to add another 10-15s process-startup cost to the single
 * most-frequently-hit tab (Overview, shown by default) for data the caller
 * already had. Never re-derive what's already on the resolved repo summary.
 */
export function getProjectOverview(repo: TNexusRepoSummary): TNexusOverview {
  return {
    branch: repo.branch,
    indexedAt: repo.indexedAt,
    upToDate: repo.status !== "update-required",
    stats: repo.stats,
  };
}
