import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { fetchRawFile } from "../gitlab/gitlab-client";
import { compareBranches, createMergeRequest, findOpenMergeRequest } from "../gitlab/gitlab-write-client";
import type { TObjectTypeRepoRef } from "./object-type-discovery";
import { buildFileDiff } from "./deploy-model-job";
import type { TDeployFileDiff } from "./deploy-model-job";
import type { TCdsModelEntity } from "./cds-model-reader";
import { accumulateCdsEntities, diffCdsEntities } from "./cds-entity-diff";
import type { TCdsEntityChange } from "./cds-entity-diff";

/**
 * "Move Model" promotes a model that already exists on one branch (e.g. a `DEV` working branch of
 * an object type's db/srv/srv_process repos) onto another branch (e.g. `main`) of the SAME repos —
 * unlike Deploy Model (`deploy-model-job.ts`), which always fabricates fresh CDS content from an
 * EDMX upload and diffs it against a repo's default branch. Here both branches already exist with
 * real history, so there's nothing to generate or commit: the preview reads both branches' current
 * content directly, and a real merge just opens a GitLab MR from `sourceBranch` straight into
 * `targetBranch`.
 */

export type TMoveModelRepoPreview = {
  role: string;
  pathWithNamespace: string;
  /** Field-level report — see `diffCdsEntities` — built only from the `.cds` files among this repo's changed files. Empty when nothing under `.cds` changed structurally (e.g. only `.csn`/`.xml`/`.properties` files differ). */
  entityChanges: TCdsEntityChange[];
  /** Every changed file, `.cds` or not — same text-diff shape Deploy Model's preview uses, so the existing `DeployChangesPreview` UI renders this unmodified. */
  files: TDeployFileDiff[];
};

export type TMoveModelPreviewResult = { sourceBranch: string; targetBranch: string; repos: TMoveModelRepoPreview[] };

export type TMoveModelResult = {
  mergeRequests: Array<{ role: string; pathWithNamespace: string; webUrl: string; iid: number; projectId: number; targetBranch: string }>;
  /** Repo where `compareBranches` found zero diffs between `sourceBranch` and `targetBranch` — nothing to merge, same "no-op" bucket Deploy Model uses. */
  noChange: Array<{ role: string; pathWithNamespace: string; sourceBranch: string; targetBranch: string }>;
  skipped: Array<{ role: string; pathWithNamespace: string; reason: string }>;
};

type TMoveModelTarget = { auth: TGitLabAuth; repos: TObjectTypeRepoRef[]; sourceBranch: string; targetBranch: string };

/**
 * Reads every file GitLab's compare API says differs between `targetBranch` and `sourceBranch` for
 * one repo, builds the same text-diff shape Deploy Model's preview produces (`buildFileDiff`), and —
 * for `.cds` files specifically — parses both sides with `parseCdsEntities` and runs them through
 * `diffCdsEntities` to get the field-level "what changed" report.
 */
async function previewRepo(auth: TGitLabAuth, repo: TObjectTypeRepoRef, sourceBranch: string, targetBranch: string): Promise<TMoveModelRepoPreview> {
  // `from`/`to` chosen so this reads as "what would land on targetBranch if sourceBranch were
  // merged into it" — matches how GitLab's own compare UI (`/-/compare/target...source`) frames it.
  const compare = await compareBranches(auth, repo.projectId, targetBranch, sourceBranch);

  const files: TDeployFileDiff[] = [];
  const oldEntities: TCdsModelEntity[] = [];
  const newEntities: TCdsModelEntity[] = [];

  for (const diff of compare.diffs) {
    const filePath = diff.new_path || diff.old_path;
    const [oldContent, newContent] = await Promise.all([
      diff.new_file ? Promise.resolve(undefined) : fetchRawFile(auth, repo.projectId, diff.old_path, targetBranch).catch(() => undefined),
      diff.deleted_file ? Promise.resolve(undefined) : fetchRawFile(auth, repo.projectId, diff.new_path, sourceBranch).catch(() => undefined),
    ]);

    const changeType: TDeployFileDiff["changeType"] = oldContent === undefined ? "create" : newContent === undefined ? "delete" : oldContent === newContent ? "no-change" : "update";
    if (changeType === "no-change") {
      files.push({ filePath, changeType, additions: 0, deletions: 0, lines: [] });
    } else {
      const { lines, additions, deletions } = buildFileDiff(oldContent ?? "", newContent ?? "");
      files.push({ filePath, changeType, additions, deletions, lines });
    }

    accumulateCdsEntities(oldEntities, diff.old_path, oldContent);
    accumulateCdsEntities(newEntities, diff.new_path, newContent);
  }

  return { role: repo.role, pathWithNamespace: repo.pathWithNamespace, entityChanges: diffCdsEntities(oldEntities, newEntities), files: files.sort((a, b) => a.filePath.localeCompare(b.filePath)) };
}

export async function previewMoveModelChanges(options: TMoveModelTarget): Promise<TMoveModelPreviewResult> {
  const repos: TMoveModelRepoPreview[] = [];
  for (const repo of options.repos) {
    repos.push(await previewRepo(options.auth, repo, options.sourceBranch, options.targetBranch));
  }
  return { sourceBranch: options.sourceBranch, targetBranch: options.targetBranch, repos };
}

export type TCreateMoveModelMergeRequestsOptions = TMoveModelTarget & {
  title?: string;
  description?: string;
  assigneeId?: number;
  reviewerIds?: number[];
};

/**
 * Opens one MR per repo, `sourceBranch` → `targetBranch` — no branch or commit is created, both
 * already exist. Re-running the same move is safe: a repo with zero diff lands in `noChange`, and a
 * repo that already has an open MR for this exact branch pair returns that MR instead of hitting
 * GitLab's 409 (see `findOpenMergeRequest`'s doc comment).
 */
export async function createMoveModelMergeRequests(options: TCreateMoveModelMergeRequestsOptions): Promise<TMoveModelResult> {
  const { auth, repos, sourceBranch, targetBranch } = options;
  const mergeRequests: TMoveModelResult["mergeRequests"] = [];
  const noChange: TMoveModelResult["noChange"] = [];
  const skipped: TMoveModelResult["skipped"] = [];

  for (const repo of repos) {
    try {
      const compare = await compareBranches(auth, repo.projectId, targetBranch, sourceBranch);
      if (!compare.diffs.length) {
        noChange.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, sourceBranch, targetBranch });
        continue;
      }

      const existing = await findOpenMergeRequest(auth, repo.projectId, sourceBranch, targetBranch);
      if (existing) {
        mergeRequests.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, webUrl: existing.web_url, iid: existing.iid, projectId: repo.projectId, targetBranch });
        continue;
      }

      const repoShortName = repo.pathWithNamespace.split("/").pop() ?? repo.pathWithNamespace;
      const mrTitle = options.title?.trim() || `[${repoShortName}] Move model: ${sourceBranch} → ${targetBranch}`;

      const mergeRequest = await createMergeRequest(auth, repo.projectId, {
        sourceBranch,
        targetBranch,
        title: mrTitle,
        description: options.description || `Move Model via SimpleMDG Tool Studio: promote \`${sourceBranch}\` into \`${targetBranch}\`.`,
        assigneeId: options.assigneeId,
        reviewerIds: options.reviewerIds,
        // Unlike Deploy Model's disposable, freshly-created feature branch, `sourceBranch` here is a
        // real, user-owned branch (e.g. a shared DEV branch) that almost certainly outlives this one
        // MR — never auto-delete it out from under them.
        removeSourceBranch: false,
      });

      mergeRequests.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, webUrl: mergeRequest.web_url, iid: mergeRequest.iid, projectId: repo.projectId, targetBranch });
    } catch (error) {
      skipped.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  return { mergeRequests, noChange, skipped };
}
