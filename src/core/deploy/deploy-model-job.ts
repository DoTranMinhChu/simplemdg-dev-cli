import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { compareBranches, createBranch, commitMultipleFiles, createMergeRequest, deleteBranch, listBranches } from "../gitlab/gitlab-write-client";
import type { TGitLabCommitAction } from "../gitlab/gitlab-write-client";
import { emitJobEvent } from "../tool/studio/job-events";
import type { TObjectTypeRepoRef } from "./object-type-discovery";

const UPLOAD_ROOT = path.join(os.tmpdir(), "smdg-tool-studio", "deploy-model-uploads");

export async function saveUploadedEdmx(fileName: string, contents: Buffer): Promise<{ uploadId: string; filePath: string }> {
  const uploadId = crypto.randomUUID();
  const uploadDir = path.join(UPLOAD_ROOT, uploadId);
  await fs.ensureDir(uploadDir);
  const safeFileName = path.basename(fileName) || "model.edmx";
  const filePath = path.join(uploadDir, safeFileName);
  await fs.writeFile(filePath, contents);
  return { uploadId, filePath };
}

export async function resolveUploadPath(uploadId: string): Promise<string> {
  const uploadDir = path.join(UPLOAD_ROOT, uploadId);
  const files = await fs.readdir(uploadDir).catch(() => []);
  if (!files.length) throw new Error(`Upload not found: ${uploadId}. Re-upload the EDMX file.`);
  return path.join(uploadDir, files[0]);
}

/**
 * `cds import <file> --dry` writes converted CSN to stdout only — no package.json or
 * `./srv/external` side effects — safe to run in a scratch directory purely to preview what the
 * import will produce (confirmed empirically: works in an otherwise-empty directory).
 */
export async function previewEdmxImport(filePath: string): Promise<{ csn: unknown; entityName: string }> {
  const entityName = path.basename(filePath, path.extname(filePath));
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "smdg-cds-preview-"));
  try {
    const localFile = path.join(scratchDir, path.basename(filePath));
    await fs.copy(filePath, localFile);
    const result = await execa("cds", ["import", localFile, "--dry"], { cwd: scratchDir, reject: false });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "cds import --dry failed");
    }
    return { csn: JSON.parse(result.stdout), entityName };
  } finally {
    await fs.remove(scratchDir).catch(() => undefined);
  }
}

export type TImportedCdsFiles = { entityName: string; csnContent: string; xmlContent: string };

/**
 * Runs the REAL `cds import <file>` (non-dry) in a scratch CAP-project-stub directory, then reads
 * back the exact `srv/external/<name>.csn` + `srv/external/<name>.xml` pair it writes — this is
 * the same artifact shape found in real customer `simplemdg_srv_*` repos (`srv/external/MDG_PRD.csn`,
 * `MDG_PRD.xml`), so committing these two files verbatim reproduces what the legacy tool's XML
 * import step actually produced.
 */
export async function runEdmxImport(filePath: string): Promise<TImportedCdsFiles> {
  const entityName = path.basename(filePath, path.extname(filePath));
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "smdg-cds-import-"));
  try {
    await fs.writeJson(path.join(scratchDir, "package.json"), { name: "tool-studio-import-scratch", cds: {} });
    const localFile = path.join(scratchDir, path.basename(filePath));
    await fs.copy(filePath, localFile);

    const result = await execa("cds", ["import", localFile], { cwd: scratchDir, reject: false });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "cds import failed");
    }

    const externalDir = path.join(scratchDir, "srv", "external");
    const csnPath = path.join(externalDir, `${entityName}.csn`);
    const xmlPath = path.join(externalDir, path.basename(filePath));

    const [csnContent, xmlContent] = await Promise.all([fs.readFile(csnPath, "utf8"), fs.readFile(xmlPath, "utf8")]);
    return { entityName, csnContent, xmlContent };
  } finally {
    await fs.remove(scratchDir).catch(() => undefined);
  }
}

export type TDeployModelOptions = {
  auth: TGitLabAuth;
  uploadId: string;
  repos: TObjectTypeRepoRef[];
  /**
   * `"f4"` deploys target the single shared, db-only `simplemdg_db_f4` repo (see
   * object-type-discovery.ts's synthetic "f4" entry) and commit to `db/external/*` — every other
   * object type targets its srv/srv_process repos and commits to `srv/external/*`. Confirmed
   * against the legacy tool's `F4_MODEL_REPO` handling, which never touches an srv counterpart.
   */
  objectTypeSlug: string;
  branchPrefix: string;
  /** Used verbatim as the MR title when non-empty (legacy tool behavior — no format/prefix validation). */
  ticketCode?: string;
  assigneeId?: number;
  reviewerIds?: number[];
};

export type TDeployModelResult = {
  entityName: string;
  mergeRequests: Array<{ role: string; pathWithNamespace: string; webUrl: string; iid: number }>;
  /**
   * Repos where the commit landed but produced zero diff against the target branch (e.g.
   * re-deploying an EDMX that converts to byte-identical CSN/XML already on the target) — the
   * legacy tool's behavior here: no MR opened, source branch auto-deleted. Kept as its own bucket
   * (not lumped into `skipped`) so the UI can tell "nothing to do" apart from a real failure.
   */
  noChange: Array<{ role: string; pathWithNamespace: string; sourceBranch: string; targetBranch: string }>;
  skipped: Array<{ role: string; pathWithNamespace: string; reason: string }>;
};

/**
 * Deploys one EDMX upload's `external/*` artifacts into the object type's repo(s) — new branch,
 * one atomic commit, one MR each — leaving the actual SAP-runtime deployment to whatever CI merges
 * the MR, same as the legacy tool.
 */
export async function runDeployModelJob(jobId: string, options: TDeployModelOptions): Promise<TDeployModelResult> {
  emitJobEvent({ jobId, type: "job-started", steps: [{ key: "import", label: "Convert EDMX to CSN", status: "running" }] });

  const filePath = await resolveUploadPath(options.uploadId);
  const imported = await runEdmxImport(filePath);
  emitJobEvent({ jobId, type: "job-step", steps: [{ key: "import", label: "Convert EDMX to CSN", status: "success", detail: imported.entityName }] });

  const isF4 = options.objectTypeSlug === "f4";
  const destinationFolder = isF4 ? "db" : "srv";
  const targetRepos = isF4 ? options.repos.filter((repo) => repo.role === "db") : options.repos.filter((repo) => repo.role === "srv" || repo.role === "srv_process");
  const mergeRequests: TDeployModelResult["mergeRequests"] = [];
  const noChange: TDeployModelResult["noChange"] = [];
  const skipped: TDeployModelResult["skipped"] = [];

  if (!targetRepos.length) {
    const message = isF4 ? "No db repo found for the F4 model." : "No srv/srv_process repo found for this object type.";
    emitJobEvent({ jobId, type: "job-failed", error: message });
    throw new Error(message);
  }

  const dateSuffix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const branchName = `${options.branchPrefix}-${dateSuffix}`;
  // Legacy tool's commit message is a bare identifier — never the ticket code — kept separate from
  // the MR title below (which IS the ticket code, verbatim, when provided). F4 always commits as
  // "F4" regardless of the uploaded file's own name (matching the legacy tool's hardcoded shortName
  // for this flow); every other object type uses the imported entity's own name.
  const commitMessage = isF4 ? "F4" : imported.entityName;

  for (const repo of targetRepos) {
    const stepKey = `repo-${repo.projectId}`;
    emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: create branch`, status: "running" }] });

    try {
      const existingBranches = await listBranches(options.auth, repo.projectId, { search: branchName });
      const branchAlreadyExists = existingBranches.data.some((branch) => branch.name === branchName);
      if (!branchAlreadyExists) {
        await createBranch(options.auth, repo.projectId, branchName, repo.defaultBranch);
      }

      const actions: TGitLabCommitAction[] = [
        { action: "create", file_path: `${destinationFolder}/external/${imported.entityName}.csn`, content: imported.csnContent },
        { action: "create", file_path: `${destinationFolder}/external/${path.basename(filePath)}`, content: imported.xmlContent },
      ];

      try {
        await commitMultipleFiles(options.auth, repo.projectId, branchName, commitMessage, actions);
      } catch {
        // Files likely already exist on this branch from a prior attempt — retry as updates.
        await commitMultipleFiles(
          options.auth,
          repo.projectId,
          branchName,
          commitMessage,
          actions.map((action) => ({ ...action, action: "update" })),
        );
      }

      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: checking for changes`, status: "running" }] });
      const compare = await compareBranches(options.auth, repo.projectId, repo.defaultBranch, branchName);
      if (!compare.diffs.length) {
        await deleteBranch(options.auth, repo.projectId, branchName).catch(() => undefined);
        noChange.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, sourceBranch: branchName, targetBranch: repo.defaultBranch });
        emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: no changes, branch removed`, status: "success" }] });
        continue;
      }

      // Ticket code becomes the literal MR title (matching the legacy tool exactly — no wrapping,
      // no validation against a fixed prefix list); the fallback below only fires when it's blank.
      const repoShortName = repo.pathWithNamespace.split("/").pop() ?? repo.pathWithNamespace;
      const mrTitle = options.ticketCode?.trim() || `[${repoShortName}][${repo.defaultBranch}] Deploy ${dateSuffix}`;

      const mergeRequest = await createMergeRequest(options.auth, repo.projectId, {
        sourceBranch: branchName,
        targetBranch: repo.defaultBranch,
        title: mrTitle,
        description: `Automated deploy of \`${imported.entityName}\` (${destinationFolder}/external/*.csn + .xml) via SimpleMDG Tool Studio.`,
        assigneeId: options.assigneeId,
        reviewerIds: options.reviewerIds,
      });

      mergeRequests.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, webUrl: mergeRequest.web_url, iid: mergeRequest.iid });
      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: MR created`, status: "success", detail: mergeRequest.web_url }] });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      skipped.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, reason: message });
      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: failed`, status: "failed", detail: message }] });
    }
  }

  emitJobEvent({ jobId, type: "job-completed", result: { entityName: imported.entityName, mergeRequests, noChange, skipped } });
  return { entityName: imported.entityName, mergeRequests, noChange, skipped };
}
