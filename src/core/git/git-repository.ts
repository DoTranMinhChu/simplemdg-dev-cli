import path from "node:path";
import fs from "fs-extra";
import { runGit, runGitSilent } from "./git-command";
import type { TGitRepoState } from "./git-types";

export async function isInsideGitRepository(cwd: string): Promise<boolean> {
  const result = await runGitSilent(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

/** Resolve the top-level directory of the git repository containing `cwd`. */
export async function getGitRepoRoot(cwd: string): Promise<string> {
  const result = await runGitSilent(["rev-parse", "--show-toplevel"], cwd);

  if (result.exitCode !== 0) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  return result.stdout.trim();
}

export async function getCurrentBranch(cwd: string): Promise<string> {
  const result = await runGitSilent(["rev-parse", "--abbrev-ref", "HEAD"], cwd);

  if (result.exitCode !== 0) {
    throw new Error("Cannot determine the current git branch.");
  }

  return result.stdout.trim();
}

/** Raw `git status --porcelain` lines (empty array means a clean working tree). */
export async function getPorcelainStatus(cwd: string): Promise<string[]> {
  const result = await runGitSilent(["status", "--porcelain"], cwd);
  return result.stdout.split("\n").map((line) => line.trimEnd()).filter(Boolean);
}

export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const lines = await getPorcelainStatus(cwd);
  return lines.length === 0;
}

export async function remoteBranchExists(cwd: string, branch: string): Promise<boolean> {
  const result = await runGitSilent(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], cwd);
  return result.exitCode === 0;
}

export async function localBranchExists(cwd: string, branch: string): Promise<boolean> {
  const result = await runGitSilent(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
  return result.exitCode === 0;
}

/** True while a `git cherry-pick` is stopped mid-way (conflict or awaiting --continue). */
export async function isCherryPickInProgress(cwd: string): Promise<boolean> {
  const root = await getGitRepoRoot(cwd).catch(() => cwd);
  return fs.pathExists(path.join(root, ".git", "CHERRY_PICK_HEAD"));
}

export async function fetchAllPruned(cwd: string): Promise<void> {
  const result = await runGit(["fetch", "--all", "--prune"], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git fetch failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

export async function getRepositoryState(cwd: string): Promise<TGitRepoState> {
  const repositoryPath = await getGitRepoRoot(cwd);
  const currentBranch = await getCurrentBranch(repositoryPath);
  const isClean = await isWorkingTreeClean(repositoryPath);
  return { repositoryPath, currentBranch, isClean };
}

/** Verify a git commit hash resolves to a real object reachable in this repo. */
export async function commitExists(cwd: string, hash: string): Promise<boolean> {
  const result = await runGitSilent(["cat-file", "-e", `${hash}^{commit}`], cwd);
  return result.exitCode === 0;
}

/** True if `path` exists as a blob in the tree of `ref` (e.g. `origin/staging`). */
export async function fileExistsAtRef(cwd: string, ref: string, filePath: string): Promise<boolean> {
  const result = await runGitSilent(["cat-file", "-e", `${ref}:${filePath}`], cwd);
  return result.exitCode === 0;
}
