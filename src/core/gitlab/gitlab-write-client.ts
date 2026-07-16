import { smartRead, buildGitLabBranchesKey, DEFAULT_CACHE_TTL } from "../cache/smart-cache";
import type { TSmartCacheResult } from "../cache/smart-cache.types";
import { gitlabFetchAll } from "./gitlab-client";
import type { TGitLabAuth } from "./gitlab-client";

export type TGitLabBranch = {
  name: string;
  default?: boolean;
  protected?: boolean;
  commit?: { id: string; short_id: string; committed_date?: string };
};

export type TGitLabUser = {
  id: number;
  username: string;
  name: string;
};

export type TGitLabCommitAction = {
  action: "create" | "update" | "delete" | "move";
  file_path: string;
  previous_path?: string;
  content?: string;
  encoding?: "text" | "base64";
};

export type TGitLabMergeRequestRequest = {
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description?: string;
  assigneeId?: number;
  reviewerIds?: number[];
  removeSourceBranch?: boolean;
};

export type TGitLabMergeRequest = {
  iid: number;
  web_url: string;
  title: string;
  state: string;
};

/** UI-agnostic: callers decide how to surface cache/refresh state (same pattern as listRootGroups/listProjects). */
export async function listBranches(auth: TGitLabAuth, projectId: number, options?: { refresh?: boolean; search?: string }): Promise<TSmartCacheResult<TGitLabBranch[]>> {
  const encodedId = encodeURIComponent(String(projectId));
  return smartRead<TGitLabBranch[]>({
    namespace: "gitlab-branches",
    key: buildGitLabBranchesKey(auth.baseUrl, projectId),
    ttlMs: DEFAULT_CACHE_TTL.gitlabBranches,
    mode: options?.refresh ? "network-only" : "stale-while-revalidate",
    fetcher: () => gitlabFetchAll<TGitLabBranch>(auth, `/projects/${encodedId}/repository/branches`, options?.search ? { search: options.search } : undefined),
  });
}

export async function createBranch(auth: TGitLabAuth, projectId: number, branchName: string, ref: string): Promise<TGitLabBranch> {
  const encodedId = encodeURIComponent(String(projectId));
  const url = new URL(`${normalizeBaseUrlLocal(auth.baseUrl)}/api/v4/projects/${encodedId}/repository/branches`);
  url.searchParams.set("branch", branchName);
  url.searchParams.set("ref", ref);
  const response = await fetch(url, { method: "POST", headers: { "PRIVATE-TOKEN": auth.token } });
  if (!response.ok) throw new Error(`GitLab branch creation failed ${response.status}: ${await response.text()}`);
  return await response.json() as TGitLabBranch;
}

/**
 * Create/update/delete several files in ONE commit via GitLab's multi-action
 * commit API — what Deploy Model uses to write generated CDS scaffolding
 * atomically per repo, instead of one commit per file.
 */
export async function commitMultipleFiles(
  auth: TGitLabAuth,
  projectId: number,
  branch: string,
  message: string,
  actions: TGitLabCommitAction[],
): Promise<{ id: string; short_id: string; web_url?: string }> {
  const encodedId = encodeURIComponent(String(projectId));
  const url = `${normalizeBaseUrlLocal(auth.baseUrl)}/api/v4/projects/${encodedId}/repository/commits`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": auth.token, "content-type": "application/json" },
    body: JSON.stringify({ branch, commit_message: message, actions }),
  });
  if (!response.ok) throw new Error(`GitLab commit failed ${response.status}: ${await response.text()}`);
  return await response.json() as { id: string; short_id: string; web_url?: string };
}

function normalizeBaseUrlLocal(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export type TGitLabCompareResult = {
  commits: unknown[];
  diffs: unknown[];
};

/**
 * Mirrors the legacy tool's pre-MR "did anything actually change" guard: it always compared the
 * new branch against the target before creating an MR, and skipped MR creation (deleting the now-
 * useless branch) when the diff was empty — e.g. re-deploying an EDMX that produces byte-identical
 * CSN/XML to what's already on the target branch.
 */
export async function compareBranches(auth: TGitLabAuth, projectId: number, from: string, to: string): Promise<TGitLabCompareResult> {
  const encodedId = encodeURIComponent(String(projectId));
  const url = new URL(`${normalizeBaseUrlLocal(auth.baseUrl)}/api/v4/projects/${encodedId}/repository/compare`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetch(url, { headers: { "PRIVATE-TOKEN": auth.token } });
  if (!response.ok) throw new Error(`GitLab compare failed ${response.status}: ${await response.text()}`);
  return await response.json() as TGitLabCompareResult;
}

export async function deleteBranch(auth: TGitLabAuth, projectId: number, branchName: string): Promise<void> {
  const encodedId = encodeURIComponent(String(projectId));
  const url = `${normalizeBaseUrlLocal(auth.baseUrl)}/api/v4/projects/${encodedId}/repository/branches/${encodeURIComponent(branchName)}`;
  const response = await fetch(url, { method: "DELETE", headers: { "PRIVATE-TOKEN": auth.token } });
  if (!response.ok && response.status !== 404) throw new Error(`GitLab branch deletion failed ${response.status}: ${await response.text()}`);
}

/** Primary assignee/reviewer resolver — scoped to people who can actually be assigned to this project. */
export async function searchProjectMembers(auth: TGitLabAuth, projectId: number, query: string): Promise<TGitLabUser[]> {
  const encodedId = encodeURIComponent(String(projectId));
  const members = await gitlabFetchAll<TGitLabUser>(auth, `/projects/${encodedId}/members/all`, query ? { query } : undefined);
  if (members.length) return members;
  // Fallback: global user search (e.g. for instance admins not yet added as project members).
  return gitlabFetchAll<TGitLabUser>(auth, "/users", query ? { search: query } : undefined);
}

export async function createMergeRequest(auth: TGitLabAuth, projectId: number, request: TGitLabMergeRequestRequest): Promise<TGitLabMergeRequest> {
  const encodedId = encodeURIComponent(String(projectId));
  const url = `${normalizeBaseUrlLocal(auth.baseUrl)}/api/v4/projects/${encodedId}/merge_requests`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": auth.token, "content-type": "application/json" },
    body: JSON.stringify({
      source_branch: request.sourceBranch,
      target_branch: request.targetBranch,
      title: request.title,
      description: request.description,
      assignee_id: request.assigneeId,
      reviewer_ids: request.reviewerIds,
      remove_source_branch: request.removeSourceBranch ?? true,
    }),
  });
  if (!response.ok) throw new Error(`GitLab merge request creation failed ${response.status}: ${await response.text()}`);
  return await response.json() as TGitLabMergeRequest;
}
