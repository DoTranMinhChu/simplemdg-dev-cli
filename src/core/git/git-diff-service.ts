import { runGitSilent } from "./git-command";
import { getMergeDiffFiles, parseNameStatus } from "./git-commit-classifier";
import { getPorcelainStatus } from "./git-repository";
import type { TGitChangedFile } from "./git-types";

/**
 * A user-selectable scope for Change Impact Analysis. Distinct from
 * `TGitLogRange` (git-move-code's remote-branch range) — these scopes cover
 * the working tree and arbitrary local refs, not just origin/<branch> pairs.
 */
export type TGitChangeScope =
  | { kind: "uncommitted" }
  | { kind: "staged" }
  | { kind: "commit"; hash: string }
  | { kind: "branch-diff"; source: string; target: string };

function dedupeByPath(files: TGitChangedFile[]): TGitChangedFile[] {
  const seen = new Map<string, TGitChangedFile>();
  for (const file of files) seen.set(file.path, file);
  return [...seen.values()];
}

/** `git diff --name-status` plus untracked (`??`) files — `git diff` alone never reports new files. */
export async function getUncommittedDiffFiles(cwd: string): Promise<TGitChangedFile[]> {
  const tracked = await runGitSilent(["diff", "--name-status"], cwd);
  const trackedFiles = tracked.exitCode === 0 ? parseNameStatus(tracked.stdout) : [];

  const porcelain = await getPorcelainStatus(cwd);
  const untrackedFiles: TGitChangedFile[] = porcelain
    .filter((line) => line.startsWith("??"))
    .map((line) => ({ status: "A", path: line.slice(3).trim() }));

  return dedupeByPath([...trackedFiles, ...untrackedFiles]);
}

export async function getStagedDiffFiles(cwd: string): Promise<TGitChangedFile[]> {
  const result = await runGitSilent(["diff", "--cached", "--name-status"], cwd);
  return result.exitCode === 0 ? parseNameStatus(result.stdout) : [];
}

/** Parent hashes of a commit, in order (first parent = mainline for a merge). */
async function getParentHashes(cwd: string, hash: string): Promise<string[]> {
  const result = await runGitSilent(["rev-list", "--parents", "-n", "1", hash], cwd);
  if (result.exitCode !== 0) return [];
  return result.stdout.trim().split(/\s+/).slice(1);
}

/** Changed files for one commit — auto-detects merge vs. normal so callers never need to know which. */
export async function getCommitDiffFiles(cwd: string, hash: string): Promise<TGitChangedFile[]> {
  const parents = await getParentHashes(cwd, hash);

  if (parents.length >= 2) {
    return getMergeDiffFiles(cwd, hash);
  }

  const result = await runGitSilent(["diff-tree", "--no-commit-id", "--name-status", "-r", hash], cwd);
  return result.exitCode === 0 ? parseNameStatus(result.stdout) : [];
}

/** Files that differ between two refs (`target..source`, double-dot — direct ancestry comparison). */
export async function getBranchDiffFiles(cwd: string, sourceBranch: string, targetBranch: string): Promise<TGitChangedFile[]> {
  const result = await runGitSilent(["diff", "--name-status", `${targetBranch}..${sourceBranch}`], cwd);
  return result.exitCode === 0 ? parseNameStatus(result.stdout) : [];
}

/** Single dispatcher over every `TGitChangeScope` — the only place that branches on `scope.kind`. */
export async function resolveChangeScopeFiles(cwd: string, scope: TGitChangeScope): Promise<TGitChangedFile[]> {
  switch (scope.kind) {
    case "uncommitted":
      return getUncommittedDiffFiles(cwd);
    case "staged":
      return getStagedDiffFiles(cwd);
    case "commit":
      return getCommitDiffFiles(cwd, scope.hash);
    case "branch-diff":
      return getBranchDiffFiles(cwd, scope.source, scope.target);
  }
}
