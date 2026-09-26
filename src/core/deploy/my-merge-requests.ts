import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { listMyMergeRequests } from "../gitlab/gitlab-write-client";
import type { TGitLabMergeRequestListItem, TMyMergeRequestsScope, TMyMergeRequestsState } from "../gitlab/gitlab-write-client";
import { getPipelineForCommit } from "./merge-orchestrator";
import type { TCommitPipeline } from "./merge-orchestrator";

export type TMyMergeRequest = {
  projectId: number;
  iid: number;
  title: string;
  state: string;
  draft: boolean;
  webUrl: string;
  pathWithNamespace: string;
  /** `pathWithNamespace` split for display: top-level group (the customer, e.g. "simplemdg-mckesson"), the groups in between, and the repo itself. */
  customer: string;
  groupPath: string;
  projectName: string;
  projectWebUrl: string;
  sourceBranch: string;
  targetBranch: string;
  author: string | undefined;
  mergedBy: string | undefined;
  labels: string[];
  /** Jira-style keys found in the title or source branch (e.g. "MCKES-660"), for filtering/sharing by ticket. */
  ticketKeys: string[];
  commitSha: string | undefined;
  commitUrl: string | undefined;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | undefined;
  /** Which branch `pipeline` ran on: the target branch after merge, the source branch while still open. */
  pipelineRef: string | undefined;
} & TCommitPipeline;

/** Caps concurrent GitLab calls — each MR costs 2 requests (pipelines + commit statuses), a page of 20 would otherwise fire 40 at once. */
const PIPELINE_LOOKUP_CONCURRENCY = 5;
const TICKET_KEY_PATTERN = /\b[A-Z][A-Z0-9]+-\d+\b/g;

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Where to look for an MR's build: once merged, the merge commit's pipeline on the target branch
 * (this project's repos only run CI there — same reasoning as `getPostMergePipeline`); while open,
 * the MR head's pipeline on the source branch (usually none here, but shown if a repo has MR CI).
 * Closed-unmerged MRs never built anything worth tracing.
 */
function pipelineLookup(mr: TGitLabMergeRequestListItem): { ref: string; sha: string } | undefined {
  if (mr.state === "merged") {
    const sha = mr.merge_commit_sha ?? mr.squash_commit_sha ?? mr.sha;
    return sha ? { ref: mr.target_branch ?? "", sha } : undefined;
  }
  if (mr.state === "opened" && mr.sha) return { ref: mr.source_branch, sha: mr.sha };
  return undefined;
}

function pathFromReference(mr: TGitLabMergeRequestListItem): string {
  // `references.full` is "group/sub/project!9" — the list endpoint has no `path_with_namespace` field.
  const full = mr.references?.full ?? "";
  const bang = full.lastIndexOf("!");
  return bang > 0 ? full.slice(0, bang) : full || String(mr.project_id);
}

function ticketKeysOf(mr: TGitLabMergeRequestListItem): string[] {
  const found = `${mr.title} ${mr.source_branch}`.toUpperCase().match(TICKET_KEY_PATTERN) ?? [];
  return [...new Set(found)];
}

function toMyMergeRequest(mr: TGitLabMergeRequestListItem, lookup: { ref: string; sha: string } | undefined, build: TCommitPipeline): TMyMergeRequest {
  const pathWithNamespace = pathFromReference(mr);
  const segments = pathWithNamespace.split("/");
  const projectWebUrl = mr.web_url.split("/-/merge_requests/")[0];
  return {
    projectId: mr.project_id,
    iid: mr.iid,
    title: mr.title,
    state: mr.state,
    draft: Boolean(mr.draft),
    webUrl: mr.web_url,
    pathWithNamespace,
    customer: segments[0] ?? "",
    groupPath: segments.slice(1, -1).join("/"),
    projectName: segments[segments.length - 1] ?? "",
    projectWebUrl,
    sourceBranch: mr.source_branch,
    targetBranch: mr.target_branch ?? "",
    author: mr.author?.name,
    mergedBy: (mr.merge_user ?? mr.merged_by)?.name,
    labels: mr.labels ?? [],
    ticketKeys: ticketKeysOf(mr),
    commitSha: lookup?.sha,
    commitUrl: lookup?.sha ? `${projectWebUrl}/-/commit/${lookup.sha}` : undefined,
    createdAt: mr.created_at,
    updatedAt: mr.updated_at,
    mergedAt: mr.merged_at ?? undefined,
    pipelineRef: lookup?.ref,
    ...build,
  };
}

export async function getMyMergeRequests(
  auth: TGitLabAuth,
  options: { scope: TMyMergeRequestsScope; state: TMyMergeRequestsState; page: number; perPage: number; search?: string },
): Promise<{ items: TMyMergeRequest[]; hasMore: boolean; page: number; total: number | undefined; totalPages: number | undefined }> {
  const { items, hasMore, total, totalPages } = await listMyMergeRequests(auth, options);
  const enriched = await mapWithConcurrency(items, PIPELINE_LOOKUP_CONCURRENCY, async (mr) => {
    const lookup = pipelineLookup(mr);
    const build = lookup?.ref ? await getPipelineForCommit(auth, mr.project_id, lookup.ref, lookup.sha) : { pipeline: undefined, externalJobs: [] };
    return toMyMergeRequest(mr, lookup, build);
  });
  return { items: enriched, hasMore, page: options.page, total, totalPages };
}
