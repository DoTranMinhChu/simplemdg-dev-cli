import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { fetchRawFile } from "../gitlab/gitlab-client";
import { createMergeRequest } from "../gitlab/gitlab-write-client";
import { emitJobEvent } from "../tool/studio/job-events";
import type { TObjectTypeRepoRef } from "./object-type-discovery";
import { cleanupClone, cloneRepoAtSourceBranch, commitAndPushBranch, createAndSwitchUpgradeBranch } from "./cds-upgrade-clone";
import { bumpCdsPackageJson, runNpmInstall } from "./cds-upgrade-install";
import { runCdsCompileValidation } from "./cds-upgrade-compile";
import type { TCdsFixupResult } from "./cds-upgrade-fixups";

/** One repo to consider, plus the clone URL discovery alone doesn't carry (see `object-type-discovery.ts`'s `TObjectTypeRepoRef`). */
export type TCdsUpgradeRepoInput = TObjectTypeRepoRef & { httpUrlToRepo: string };

export type TCdsUpgradeBucket = "upgraded" | "alreadyUpToDate" | "branchNotFound" | "buildFailed" | "skipped";

export type TCdsUpgradeRepoOutcome = {
  role: string;
  pathWithNamespace: string;
  projectId: number;
  bucket: TCdsUpgradeBucket;
  currentVersion?: string;
  detail?: string;
  mergeRequestUrl?: string;
  appliedFixups?: TCdsFixupResult[];
};

export type TCdsUpgradeResult = {
  upgraded: TCdsUpgradeRepoOutcome[];
  alreadyUpToDate: TCdsUpgradeRepoOutcome[];
  branchNotFound: TCdsUpgradeRepoOutcome[];
  buildFailed: TCdsUpgradeRepoOutcome[];
  skipped: TCdsUpgradeRepoOutcome[];
};

export type TCdsUpgradeOptions = {
  auth: TGitLabAuth;
  /** One fixed branch name, typed by the user, checked across every repo — not a per-repo picker. */
  sourceBranch: string;
  /** Exact semver typed by the user each run — nothing persisted. */
  targetVersion: string;
  repos: TCdsUpgradeRepoInput[];
};

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const partsB = b.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(partsA.length, partsB.length); index += 1) {
    const diff = (partsA[index] ?? 0) - (partsB[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function readCurrentCdsVersion(auth: TGitLabAuth, projectId: number, sourceBranch: string): Promise<{ version?: string } | { branchNotFound: true }> {
  const raw = await fetchRawFile(auth, projectId, "package.json", sourceBranch).catch(() => undefined);
  if (raw === undefined) return { branchNotFound: true };

  try {
    const packageJson = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const version = packageJson.dependencies?.["@sap/cds"] ?? packageJson.devDependencies?.["@sap/cds"];
    return { version: version?.replace(/^[\^~]/, "") };
  } catch {
    return {};
  }
}

export type TCdsUpgradePreviewRow = {
  role: string;
  pathWithNamespace: string;
  projectId: number;
  bucket: "wouldUpgrade" | "alreadyUpToDate" | "branchNotFound" | "unknownVersion";
  currentVersion?: string;
};

/**
 * Pure, read-only dry-run — zero clones, zero writes. Reuses only `fetchRawFile` (no local git at
 * all) so the user can see exactly which repos/branches would actually be touched before anything
 * is cloned, installed, or pushed. The frontend gates the real "Run" button on this having been
 * called at least once.
 */
export async function previewCdsUpgrade(auth: TGitLabAuth, sourceBranch: string, targetVersion: string, repos: TCdsUpgradeRepoInput[]): Promise<TCdsUpgradePreviewRow[]> {
  return Promise.all(
    repos.map(async (repo): Promise<TCdsUpgradePreviewRow> => {
      const current = await readCurrentCdsVersion(auth, repo.projectId, sourceBranch);
      if ("branchNotFound" in current) {
        return { role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "branchNotFound" };
      }
      if (!current.version) {
        return { role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "unknownVersion" };
      }
      const bucket = compareVersions(current.version, targetVersion) >= 0 ? "alreadyUpToDate" : "wouldUpgrade";
      return { role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket, currentVersion: current.version };
    }),
  );
}

function emptyResult(): TCdsUpgradeResult {
  return { upgraded: [], alreadyUpToDate: [], branchNotFound: [], buildFailed: [], skipped: [] };
}

function tailOf(text: string, maxLines = 40): string {
  const lines = text.split("\n");
  return lines.length > maxLines ? `... (${lines.length - maxLines} earlier line(s) omitted)\n${lines.slice(-maxLines).join("\n")}` : text;
}

/**
 * Bulk-upgrades `@sap/cds`/`@sap/cds-dk`/`@sap/cds-compiler` to `targetVersion` on one fixed branch
 * across every given repo. One repo's failure at any stage is fully isolated (its own try/catch) —
 * it never aborts the batch. New branch only; a Merge Request is opened but NEVER auto-merged.
 */
export async function runCdsUpgradeJob(jobId: string, options: TCdsUpgradeOptions): Promise<TCdsUpgradeResult> {
  emitJobEvent({ jobId, type: "job-started", steps: options.repos.map((repo) => ({ key: `repo-${repo.projectId}`, label: `${repo.pathWithNamespace}: queued`, status: "pending" })) });

  const result = emptyResult();
  const scratchRoot = path.join(os.tmpdir(), "smdg-cds-upgrade", jobId);
  const newBranchName = `cds-upgrade/${options.targetVersion}-${jobId.slice(0, 8)}`;

  for (const repo of options.repos) {
    const stepKey = `repo-${repo.projectId}`;
    const step = (label: string, status: "running" | "success" | "failed", detail?: string) =>
      emitJobEvent({ jobId, type: "job-step", steps: [{ key: stepKey, label: `${repo.pathWithNamespace}: ${label}`, status, detail }] });

    let repoPath: string | undefined;
    try {
      step("checking current version", "running");
      const current = await readCurrentCdsVersion(options.auth, repo.projectId, options.sourceBranch);
      if ("branchNotFound" in current) {
        result.branchNotFound.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "branchNotFound" });
        step(`branch "${options.sourceBranch}" not found`, "failed");
        continue;
      }
      if (current.version && compareVersions(current.version, options.targetVersion) >= 0) {
        result.alreadyUpToDate.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "alreadyUpToDate", currentVersion: current.version });
        step(`already at v${current.version}`, "success");
        continue;
      }

      step("clone", "running");
      const cloned = await cloneRepoAtSourceBranch(options.auth, repo, options.sourceBranch, scratchRoot);
      if ("branchNotFound" in cloned) {
        result.branchNotFound.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "branchNotFound" });
        step(`branch "${options.sourceBranch}" not found`, "failed");
        continue;
      }
      repoPath = cloned.repoPath;

      await createAndSwitchUpgradeBranch(repoPath, options.auth, newBranchName);

      step("bump package.json + apply known fixups", "running");
      const bump = await bumpCdsPackageJson(repoPath, options.targetVersion);
      step("bump package.json + apply known fixups", "success", bump.fixups.length ? bump.fixups.map((f) => f.title).join("; ") : "no known fixups applied");

      step("npm install", "running");
      const install = await runNpmInstall(repoPath);
      if (install.exitCode !== 0 || install.timedOut) {
        const detail = install.timedOut ? "npm install timed out" : tailOf(install.stderr || install.stdout);
        result.buildFailed.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "buildFailed", currentVersion: current.version, detail, appliedFixups: bump.fixups });
        step("npm install failed", "failed", detail);
        continue;
      }

      step("cds compile", "running");
      const compile = await runCdsCompileValidation(repoPath, repo.role);
      if (!compile.ok) {
        const detail = compile.timedOut ? "cds compile timed out" : tailOf(compile.stderr || compile.stdout || "cds compile failed");
        result.buildFailed.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "buildFailed", currentVersion: current.version, detail, appliedFixups: bump.fixups });
        step("cds compile failed", "failed", detail);
        continue;
      }

      step("commit + push", "running");
      const fixupSummary = bump.fixups.length ? `\n\nApplied fixups:\n${bump.fixups.map((f) => `- ${f.title} (${f.note})`).join("\n")}` : "";
      await commitAndPushBranch(repoPath, options.auth, newBranchName, `Upgrade @sap/cds to ${options.targetVersion}`);

      step("open merge request", "running");
      const mergeRequest = await createMergeRequest(options.auth, repo.projectId, {
        sourceBranch: newBranchName,
        targetBranch: options.sourceBranch,
        title: `cds-upgrade: @sap/cds -> ${options.targetVersion}`,
        description: `Automated @sap/cds/@sap/cds-dk/@sap/cds-compiler version bump to ${options.targetVersion}, validated with a real npm install + cds compile before this MR was opened.${fixupSummary}`,
      });

      result.upgraded.push({
        role: repo.role,
        pathWithNamespace: repo.pathWithNamespace,
        projectId: repo.projectId,
        bucket: "upgraded",
        currentVersion: current.version,
        mergeRequestUrl: mergeRequest.web_url,
        appliedFixups: bump.fixups,
      });
      step("MR opened", "success", mergeRequest.web_url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.skipped.push({ role: repo.role, pathWithNamespace: repo.pathWithNamespace, projectId: repo.projectId, bucket: "skipped", detail: message });
      step("failed", "failed", message);
    } finally {
      if (repoPath) await cleanupClone(repoPath);
    }
  }

  await fs.remove(scratchRoot).catch(() => undefined);
  emitJobEvent({ jobId, type: "job-completed", result });
  return result;
}
