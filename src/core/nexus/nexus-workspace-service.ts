import { runGitNexus, runGitNexusJson, type TGitNexusCliResult } from "./gitnexus-cli-client";
import { normalizeRisk } from "./nexus-query-service";
import type { TNexusRiskLevel } from "./nexus-types";

/**
 * Thin wrapper over `gitnexus group` — GitNexus's own multi-repo grouping
 * feature (create/add/remove/list/status/sync/impact/query/contracts),
 * confirmed by spike to be a mature, first-class capability. This CLI's
 * "workspace" concept (product spec section 7) is deliberately NOT a separate
 * homegrown store — it IS a `gitnexus group`, so cross-repo impact/search/
 * contract-relationship data stays exactly as fresh as GitNexus's own.
 *
 * Known gap: GitNexus has no `group delete` (only `group remove <path>` for
 * one member at a time) — there is no CLI-safe way to fully delete a group,
 * so this file doesn't expose one either rather than reaching into
 * `~/.gitnexus/groups/` internals directly.
 */

export function parseGroupList(stdout: string): string[] {
  if (/no groups configured/i.test(stdout)) return [];
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^groups:$/i.test(line));
}

export type TGroupMemberStatus = { groupPath: string; indexStatus: string; contractsStatus: string };
export type TGroupStatus = { name: string; synced: boolean; members: TGroupMemberStatus[] };

export function parseGroupStatus(name: string, stdout: string): TGroupStatus {
  const synced = !/never synced/i.test(stdout);
  const members: TGroupMemberStatus[] = [];

  for (const rawLine of stdout.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^group:/i.test(trimmed) || /repo index/i.test(trimmed)) continue;

    const parts = trimmed.split(/\s{2,}/).filter(Boolean);
    if (parts.length >= 2) {
      members.push({ groupPath: parts[0], indexStatus: parts[1] ?? "", contractsStatus: parts[2] ?? "" });
    }
  }

  return { name, synced, members };
}

export async function listWorkspaces(): Promise<{ ok: true; names: string[] } | { ok: false; message: string }> {
  const result = await runGitNexus(["group", "list"]);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, names: parseGroupList(result.stdout) };
}

export async function createWorkspace(name: string): Promise<TGitNexusCliResult> {
  return runGitNexus(["group", "create", name]);
}

/** `groupPath` is the hierarchy path within the group (e.g. "hr/hiring/backend"); `registryName` is the repo's GitNexus registry alias. */
export async function addRepoToWorkspace(workspace: string, groupPath: string, registryName: string): Promise<TGitNexusCliResult> {
  return runGitNexus(["group", "add", workspace, groupPath, registryName]);
}

export async function removeRepoFromWorkspace(workspace: string, groupPath: string): Promise<TGitNexusCliResult> {
  return runGitNexus(["group", "remove", workspace, groupPath]);
}

export async function getWorkspaceStatus(name: string): Promise<{ ok: true; status: TGroupStatus } | { ok: false; message: string }> {
  const result = await runGitNexus(["group", "status", name]);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, status: parseGroupStatus(name, result.stdout) };
}

/** Extracts cross-repo "contracts" (shared package/API/event relationships) and rebuilds cross-links — must run at least once before workspace-level impact/search return cross-repo results. */
export async function syncWorkspace(name: string): Promise<TGitNexusCliResult> {
  return runGitNexus(["group", "sync", name]);
}

export type TNexusWorkspaceImpactResult = {
  risk: TNexusRiskLevel;
  directCount: number;
  processesAffected: number;
  modulesAffected: number;
  crossRepoHits: number;
  affectedProcesses: Array<{ name: string; filePath: string }>;
  /** Raw `cross` entries from GitNexus — shape not fully verified (every repo tested during
   * implementation had 0 cross-repo hits), so this is passed through for an "Advanced" raw view
   * rather than parsed into typed fields we can't confirm are correct. */
  crossRepoRaw: unknown[];
};

type TRawGroupImpactResponse = {
  local?: {
    affected_processes?: Array<{ name: string; filePath: string }>;
  };
  cross?: unknown[];
  summary?: { direct: number; processes_affected: number; modules_affected: number; cross_repo_hits: number };
  risk?: string;
};

/** Cross-repo blast-radius for a symbol in one member repo — `groupPath` is the member's path within the group (e.g. "root"), NOT its registry name. Requires `syncWorkspace` to have run at least once for cross-repo hits to be possible. */
export async function getWorkspaceImpact(name: string, groupPath: string, target: string): Promise<{ ok: true; result: TNexusWorkspaceImpactResult } | { ok: false; message: string }> {
  const result = await runGitNexusJson<TRawGroupImpactResponse>(["group", "impact", name, "--target", target, "--repo", groupPath, "--json"]);
  if (!result.ok) return { ok: false, message: result.message };

  const data = result.data;
  return {
    ok: true,
    result: {
      risk: normalizeRisk(data.risk),
      directCount: data.summary?.direct ?? 0,
      processesAffected: data.summary?.processes_affected ?? 0,
      modulesAffected: data.summary?.modules_affected ?? 0,
      crossRepoHits: data.summary?.cross_repo_hits ?? 0,
      affectedProcesses: data.local?.affected_processes ?? [],
      crossRepoRaw: data.cross ?? [],
    },
  };
}

export type TNexusWorkspaceSearchResult = {
  perRepo: Array<{ repo: string; count: number }>;
  /** Raw `results` entries — same "not fully verified, shown as Advanced raw data" rationale as `crossRepoRaw` above (every real query during implementation returned an empty array). */
  resultsRaw: unknown[];
};

type TRawGroupQueryResponse = {
  results?: unknown[];
  per_repo?: Array<{ repo: string; count: number }>;
};

/** "Search execution flows across all repos in a group" — wraps `gitnexus group query`. */
export async function searchWorkspace(name: string, query: string): Promise<{ ok: true; result: TNexusWorkspaceSearchResult } | { ok: false; message: string }> {
  const result = await runGitNexusJson<TRawGroupQueryResponse>(["group", "query", name, query, "--json"]);
  if (!result.ok) return { ok: false, message: result.message };

  return {
    ok: true,
    result: {
      perRepo: result.data.per_repo ?? [],
      resultsRaw: result.data.results ?? [],
    },
  };
}

export type TNexusContract = { direction: string; key: string; repo: string; symbolName: string };

/**
 * `gitnexus group contracts` output, e.g.:
 *   Contracts (15):
 *     [consumer] http::GET::/json/list  (root)  getNodeInspectorDebugUrl
 *
 *   Cross-links (0):
 * Auto-detected HTTP/shared-package contracts per member repo — this is the concrete data behind
 * spec section 7's "shared package dependencies" / "API relationships" for a workspace.
 */
export function parseGroupContracts(stdout: string): TNexusContract[] {
  const contracts: TNexusContract[] = [];
  const pattern = /^\s*\[(\w+)\]\s+(.+?)\s+\((\S+)\)\s+(\S+)\s*$/;

  for (const rawLine of stdout.split("\n")) {
    const match = pattern.exec(rawLine);
    if (!match) continue;
    contracts.push({ direction: match[1], key: match[2].trim(), repo: match[3], symbolName: match[4] });
  }

  return contracts;
}

export async function getWorkspaceContracts(name: string): Promise<{ ok: true; contracts: TNexusContract[] } | { ok: false; message: string }> {
  const result = await runGitNexus(["group", "contracts", name]);
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, contracts: parseGroupContracts(result.stdout) };
}
