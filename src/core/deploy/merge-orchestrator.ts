import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { getMergeRequest, listCommitStatuses, listPipelinesForRef, mergeMergeRequest } from "../gitlab/gitlab-write-client";
import { emitJobEvent } from "../tool/studio/job-events";

export type TMergeTarget = { role: string; pathWithNamespace: string; projectId: number; mrIid: number; targetBranch: string };

/**
 * Live status for one already-created MR — polled by the UI so it can show merge/pipeline state
 * (plus mergeability: draft, conflicts, unresolved discussions, GitLab's own `merge_error`) without
 * the user opening GitLab. `blockers` is empty once the MR is actually mergeable (or already
 * merged/closed, where blockers stop being meaningful) — the UI surfaces it as a warning, not a hard
 * gate: GitLab's own merge call is still the authoritative check, this is purely visibility.
 */
export type TMergeRequestStatus = {
  state: string;
  mergedAt: string | undefined;
  /** Before merge: the MR's head pipeline (if any). After merge: the merge commit's pipeline on the target branch. */
  pipeline: { id: number; status: string; webUrl: string; sha?: string; ref?: string; createdAt?: string; updatedAt?: string } | undefined;
  /** External CI jobs (Jenkins) reported on the merge commit, each linking to its own build page. */
  externalJobs: { name: string; status: string; targetUrl: string }[];
  draft: boolean;
  hasConflicts: boolean;
  changesCount: string | undefined;
  blockers: string[];
};

/** Statuses GitLab reports on a MR that isn't actually blocked from merging — surfaced via the pipeline badge already, or simply "in progress", not worth a separate blocker line. */
const NON_BLOCKING_MERGE_STATUSES = new Set(["mergeable", "ci_still_running", "checking", "unchecked", "preparing"]);

function computeBlockers(detail: Awaited<ReturnType<typeof getMergeRequest>>): string[] {
  if (detail.state === "merged" || detail.state === "closed") return [];
  const blockers: string[] = [];
  if (detail.draft) blockers.push("Draft — not ready for review");
  if (detail.has_conflicts) blockers.push("Has merge conflicts");
  if (detail.blocking_discussions_resolved === false) blockers.push("Unresolved discussions");
  if (detail.merge_error) blockers.push(detail.merge_error);
  // Catch-all for any other blocking `detailed_merge_status` this doesn't already special-case above
  // (e.g. `not_approved`, `need_rebase`) — shown verbatim (underscores turned to spaces) rather than
  // silently dropped just because it isn't one of the specific fields checked already.
  if (!blockers.length && detail.detailed_merge_status && !NON_BLOCKING_MERGE_STATUSES.has(detail.detailed_merge_status)) {
    blockers.push(detail.detailed_merge_status.replace(/_/g, " "));
  }
  return blockers;
}

/**
 * The pipeline a merged MR's merge commit triggered on its target branch — the "Pipeline #N running
 * for <sha> on <branch>" block GitLab's own MR page shows after merge. `head_pipeline` can't provide
 * this: it's the MR's *source*-branch pipeline, which this project's repos never run (CI only fires
 * on the target branch after merge), so it stays null. Also returns the SHA's external commit
 * statuses (Jenkins jobs) with their build-page links. Best-effort: lookup failures just mean no
 * pipeline shown, never a failed status call.
 */
async function getPostMergePipeline(
  auth: TGitLabAuth,
  projectId: number,
  detail: Awaited<ReturnType<typeof getMergeRequest>>,
): Promise<TCommitPipeline> {
  const sha = detail.merge_commit_sha ?? detail.squash_commit_sha ?? detail.sha;
  if (!sha || !detail.target_branch) return { pipeline: undefined, externalJobs: [] };
  return getPipelineForCommit(auth, projectId, detail.target_branch, sha);
}

export type TCommitPipeline = { pipeline: TMergeRequestStatus["pipeline"]; externalJobs: TMergeRequestStatus["externalJobs"] };

/** The pipeline `sha` triggered on `ref`, plus its external (Jenkins) commit statuses — best-effort, never throws. */
export async function getPipelineForCommit(auth: TGitLabAuth, projectId: number, ref: string, sha: string): Promise<TCommitPipeline> {
  const [pipelines, statuses] = await Promise.all([
    listPipelinesForRef(auth, projectId, ref, { sha }).catch(() => []),
    listCommitStatuses(auth, projectId, sha).catch(() => []),
  ]);
  const match = pipelines[0];
  return {
    pipeline: match ? { id: match.id, status: match.status, webUrl: match.web_url, sha, ref, createdAt: match.created_at, updatedAt: match.updated_at } : undefined,
    externalJobs: statuses
      .filter((status) => status.target_url)
      .map((status) => ({ name: status.name, status: status.status, targetUrl: status.target_url! })),
  };
}

export async function getMergeRequestStatus(auth: TGitLabAuth, projectId: number, mrIid: number): Promise<TMergeRequestStatus> {
  const detail = await getMergeRequest(auth, projectId, mrIid);
  const postMerge = detail.state === "merged" ? await getPostMergePipeline(auth, projectId, detail) : undefined;
  return {
    state: detail.state,
    mergedAt: detail.state === "merged" ? new Date().toISOString() : undefined,
    pipeline: postMerge
      ? postMerge.pipeline
      : detail.head_pipeline
        ? { id: detail.head_pipeline.id, status: detail.head_pipeline.status, webUrl: detail.head_pipeline.web_url, sha: detail.head_pipeline.sha, ref: detail.target_branch }
        : undefined,
    externalJobs: postMerge?.externalJobs ?? [],
    draft: Boolean(detail.draft),
    hasConflicts: Boolean(detail.has_conflicts),
    changesCount: detail.changes_count ?? undefined,
    blockers: computeBlockers(detail),
  };
}

const TERMINAL_PIPELINE_STATUSES = new Set(["success", "failed", "canceled", "skipped"]);
const POLL_INTERVAL_MS = 8000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls the target branch's pipelines until the one triggered by `mergeCommitSha` reaches a
 * terminal status (or the poll times out). GitLab's merge response doesn't hand back "the pipeline
 * this merge triggered" directly — a merge to a branch with CI configured kicks off a NEW pipeline
 * on that branch asynchronously, so the only reliable way to find it is to poll the branch's own
 * pipeline list and match by commit SHA.
 */
async function waitForPostMergePipeline(
  auth: TGitLabAuth,
  projectId: number,
  targetBranch: string,
  mergeCommitSha: string | undefined,
  onUpdate: (status: string, pipeline?: { id: number; webUrl: string }) => void,
): Promise<"success" | "failed" | "timeout" | "no-pipeline"> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let sawAnyPipeline = false;

  while (Date.now() < deadline) {
    const pipelines = await listPipelinesForRef(auth, projectId, targetBranch, mergeCommitSha ? { sha: mergeCommitSha } : undefined);
    const match = pipelines[0];
    if (match) {
      sawAnyPipeline = true;
      onUpdate(match.status, { id: match.id, webUrl: match.web_url });
      if (TERMINAL_PIPELINE_STATUSES.has(match.status)) {
        return match.status === "success" ? "success" : "failed";
      }
    } else {
      onUpdate("waiting");
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return sawAnyPipeline ? "timeout" : "no-pipeline";
}

/**
 * Merges the `db` MR first, waits for the pipeline its merge commit triggers on the target branch,
 * and only merges the remaining MRs (`srv`/`srv_process`) if that pipeline succeeds — mirrors the
 * manual workflow the user already follows (merge db, watch the build, only then merge the rest),
 * just automated. Stops (without merging the rest) on any failure, timeout, or a target branch with
 * no CI configured at all (nothing to wait for is treated as a stop, not a silent skip — the user
 * asked this to gate on a real build result, not merge blindly).
 */
export async function runAutoMergeJob(jobId: string, options: { auth: TGitLabAuth; dbTarget: TMergeTarget; restTargets: TMergeTarget[] }): Promise<void> {
  const { auth, dbTarget, restTargets } = options;
  const dbStepKey = `merge-${dbTarget.role}`;
  const pipelineStepKey = "pipeline";

  emitJobEvent({ jobId, type: "job-started", steps: [{ key: dbStepKey, label: `Merge ${dbTarget.pathWithNamespace}`, status: "running" }] });

  let mergeCommitSha: string | undefined;
  try {
    const merged = await mergeMergeRequest(auth, dbTarget.projectId, dbTarget.mrIid);
    mergeCommitSha = merged.merge_commit_sha;
    emitJobEvent({ jobId, type: "job-step", steps: [{ key: dbStepKey, label: `Merge ${dbTarget.pathWithNamespace}`, status: "success", detail: mergeCommitSha ? `merged (${mergeCommitSha.slice(0, 8)})` : "merged" }] });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitJobEvent({ jobId, type: "job-step", steps: [{ key: dbStepKey, label: `Merge ${dbTarget.pathWithNamespace}`, status: "failed", detail: message }] });
    emitJobEvent({ jobId, type: "job-failed", error: message });
    return;
  }

  emitJobEvent({ jobId, type: "job-step", steps: [{ key: pipelineStepKey, label: `Wait for ${dbTarget.targetBranch} pipeline`, status: "running", detail: "waiting for the pipeline to start..." }] });

  const pipelineResult = await waitForPostMergePipeline(auth, dbTarget.projectId, dbTarget.targetBranch, mergeCommitSha, (status, pipeline) => {
    const isTerminal = TERMINAL_PIPELINE_STATUSES.has(status);
    emitJobEvent({
      jobId,
      type: "job-step",
      steps: [
        {
          key: pipelineStepKey,
          label: `Wait for ${dbTarget.targetBranch} pipeline`,
          status: isTerminal ? (status === "success" ? "success" : "failed") : "running",
          detail: pipeline ? undefined : status,
          // Once GitLab reports a real pipeline, the UI renders it as the same clickable
          // `PipelineBadge` pill the per-MR live-status row uses instead of this plain text detail.
          pipeline: pipeline ? { id: pipeline.id, status, webUrl: pipeline.webUrl } : undefined,
        },
      ],
    });
  });

  if (pipelineResult !== "success") {
    const message =
      pipelineResult === "timeout"
        ? `Timed out after 30 minutes waiting for the ${dbTarget.targetBranch} pipeline — not merging srv/srv_process. Check it on GitLab and merge the rest manually once it's green.`
        : pipelineResult === "no-pipeline"
          ? `No pipeline appeared on ${dbTarget.targetBranch} after merging — not merging srv/srv_process automatically. Merge the rest manually if this target branch has no CI configured.`
          : `The ${dbTarget.targetBranch} pipeline failed — not merging srv/srv_process.`;
    emitJobEvent({ jobId, type: "job-step", steps: [{ key: pipelineStepKey, label: `Wait for ${dbTarget.targetBranch} pipeline`, status: "failed", detail: message }] });
    emitJobEvent({ jobId, type: "job-failed", error: message });
    return;
  }

  for (const target of restTargets) {
    const stepKey = `merge-${target.role}`;
    emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `Merge ${target.pathWithNamespace}`, status: "running" }] });
    try {
      await mergeMergeRequest(auth, target.projectId, target.mrIid);
      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `Merge ${target.pathWithNamespace}`, status: "success", detail: "merged" }] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `Merge ${target.pathWithNamespace}`, status: "failed", detail: message }] });
    }
  }

  emitJobEvent({ jobId, type: "job-completed", result: {} });
}
