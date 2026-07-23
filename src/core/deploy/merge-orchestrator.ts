import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { getMergeRequest, listPipelinesForRef, mergeMergeRequest } from "../gitlab/gitlab-write-client";
import { emitJobEvent } from "../tool/studio/job-events";

export type TMergeTarget = { role: string; pathWithNamespace: string; projectId: number; mrIid: number; targetBranch: string };

/** Live status for one already-created MR — polled by the UI so it can show merge/pipeline state without the user opening GitLab. */
export type TMergeRequestStatus = {
  state: string;
  mergedAt: string | undefined;
  pipeline: { id: number; status: string; webUrl: string } | undefined;
};

export async function getMergeRequestStatus(auth: TGitLabAuth, projectId: number, mrIid: number): Promise<TMergeRequestStatus> {
  const detail = await getMergeRequest(auth, projectId, mrIid);
  return {
    state: detail.state,
    mergedAt: detail.state === "merged" ? new Date().toISOString() : undefined,
    pipeline: detail.head_pipeline ? { id: detail.head_pipeline.id, status: detail.head_pipeline.status, webUrl: detail.head_pipeline.web_url } : undefined,
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
  onUpdate: (status: string, webUrl?: string) => void,
): Promise<"success" | "failed" | "timeout" | "no-pipeline"> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let sawAnyPipeline = false;

  while (Date.now() < deadline) {
    const pipelines = await listPipelinesForRef(auth, projectId, targetBranch, mergeCommitSha ? { sha: mergeCommitSha } : undefined);
    const match = pipelines[0];
    if (match) {
      sawAnyPipeline = true;
      onUpdate(match.status, match.web_url);
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

  const pipelineResult = await waitForPostMergePipeline(auth, dbTarget.projectId, dbTarget.targetBranch, mergeCommitSha, (status, webUrl) => {
    const isTerminal = TERMINAL_PIPELINE_STATUSES.has(status);
    emitJobEvent({
      jobId,
      type: "job-step",
      steps: [{ key: pipelineStepKey, label: `Wait for ${dbTarget.targetBranch} pipeline`, status: isTerminal ? (status === "success" ? "success" : "failed") : "running", detail: webUrl ? `${status} — ${webUrl}` : status }],
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
