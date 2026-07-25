import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import { execa } from "execa";
import type { TGitLabAuth } from "../gitlab/gitlab-client";

/**
 * A real local git clone is only needed here (unlike the rest of Tool
 * Studio's deploy features, which read/write entirely through the GitLab
 * API) because validating a CDS-version upgrade requires an actual
 * `npm install` + `cds compile` run — there's no way to do that against a
 * remote branch without a real checkout.
 *
 * `src/commands/gitlab.command.ts` already has a `gitEnv`/`runGit`/
 * `cloneOrUpdateProject` trio for this, but they're private (not exported)
 * and `src/core/**` never imports from `src/commands/**` — so this
 * duplicates the same `GIT_ASKPASS` temp-script auth trick rather than
 * reaching into that module, and is deliberately narrower than
 * `cloneOrUpdateProject`'s `pull-all` mode (which syncs every remote
 * branch): this only ever needs one branch, shallow, then a brand-new
 * branch off its tip.
 */

const GIT_TIMEOUT_MS = 2 * 60_000;

function gitEnvForAuth(auth: TGitLabAuth): NodeJS.ProcessEnv {
  const askPass = path.join(os.tmpdir(), `smdg-cds-upgrade-askpass-${crypto.randomBytes(6).toString("hex")}${process.platform === "win32" ? ".cmd" : ".sh"}`);
  if (process.platform === "win32") {
    fs.writeFileSync(askPass, `@echo off\r\necho %SMDG_GIT_ASKPASS_VALUE%\r\n`);
  } else {
    fs.writeFileSync(askPass, `#!/bin/sh\nprintf '%s\\n' "$SMDG_GIT_ASKPASS_VALUE"\n`);
    fs.chmodSync(askPass, 0o700);
  }
  return { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: askPass, SMDG_GIT_ASKPASS_VALUE: auth.token };
}

async function runGit(repoPath: string | undefined, args: string[], auth: TGitLabAuth): Promise<{ ok: boolean; output: string }> {
  const result = await execa("git", args, { cwd: repoPath, reject: false, env: gitEnvForAuth(auth), timeout: GIT_TIMEOUT_MS });
  return { ok: (result.exitCode ?? 0) === 0, output: [result.stdout, result.stderr].filter(Boolean).join("\n") };
}

export type TCloneProjectRef = { projectId: number; httpUrlToRepo: string; pathWithNamespace: string };

export type TCloneResult = { repoPath: string } | { branchNotFound: true };

const BRANCH_NOT_FOUND_RE = /remote branch .* not found|couldn'?t find remote ref/i;

/** Shallow-clones exactly `sourceBranch`'s tip into `scratchRoot/<projectId>` — never the full history/every branch. Distinguishes "branch doesn't exist" from other clone failures so the job can bucket it precisely instead of a generic error. */
export async function cloneRepoAtSourceBranch(auth: TGitLabAuth, project: TCloneProjectRef, sourceBranch: string, scratchRoot: string): Promise<TCloneResult> {
  const repoPath = path.join(scratchRoot, String(project.projectId));
  await fs.ensureDir(path.dirname(repoPath));

  const clone = await runGit(undefined, ["clone", "--depth", "1", "--branch", sourceBranch, "--single-branch", project.httpUrlToRepo, repoPath], auth);
  if (!clone.ok) {
    if (BRANCH_NOT_FOUND_RE.test(clone.output)) {
      return { branchNotFound: true };
    }
    throw new Error(clone.output || `git clone failed for ${project.pathWithNamespace}`);
  }

  return { repoPath };
}

/** Creates the brand-new upgrade branch from the clone's current tip (already `sourceBranch`'s HEAD from the shallow clone above) and switches to it — this repo's source branch is never written to. */
export async function createAndSwitchUpgradeBranch(repoPath: string, auth: TGitLabAuth, newBranchName: string): Promise<void> {
  const result = await runGit(repoPath, ["switch", "-c", newBranchName], auth);
  if (!result.ok) throw new Error(result.output || `Failed to create branch ${newBranchName}`);
}

/** Commits every pending change and pushes ONLY the new branch — never the source branch. */
export async function commitAndPushBranch(repoPath: string, auth: TGitLabAuth, newBranchName: string, message: string): Promise<void> {
  const add = await runGit(repoPath, ["add", "-A"], auth);
  if (!add.ok) throw new Error(add.output || "git add failed");

  const commit = await runGit(repoPath, ["-c", "user.email=smdg-tool-studio@localhost", "-c", "user.name=SimpleMDG Tool Studio", "commit", "-m", message], auth);
  if (!commit.ok) throw new Error(commit.output || "git commit failed");

  const push = await runGit(repoPath, ["push", "-u", "origin", newBranchName], auth);
  if (!push.ok) throw new Error(push.output || `git push failed for ${newBranchName}`);
}

export async function cleanupClone(repoPath: string): Promise<void> {
  await fs.remove(repoPath).catch(() => undefined);
}
