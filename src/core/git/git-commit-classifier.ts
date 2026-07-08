import { runGitSilent } from "./git-command";
import type { TGitCandidateCommit, TGitChangedFile } from "./git-types";

/**
 * Parse `git diff --name-status` output into structured changed-file records.
 * Handles rename/copy lines (e.g. `R100\told\tnew`) by capturing the old path.
 */
export function parseNameStatus(output: string): TGitChangedFile[] {
  const files: TGitChangedFile[] = [];

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const status = parts[0];

    if (!status) continue;

    if ((status.startsWith("R") || status.startsWith("C")) && parts.length >= 3) {
      files.push({ status, oldPath: parts[1], path: parts[2] });
    } else if (parts.length >= 2) {
      files.push({ status, path: parts[1] });
    }
  }

  return files;
}

/** `git diff --name-status <mergeCommit>^1 <mergeCommit>` — what the merge actually changed relative to mainline. */
export async function getMergeDiffFiles(cwd: string, mergeHash: string): Promise<TGitChangedFile[]> {
  const result = await runGitSilent(["diff", "--name-status", `${mergeHash}^1`, mergeHash], cwd);

  if (result.exitCode !== 0) {
    throw new Error(`Cannot diff merge commit ${mergeHash}: ${(result.stderr || result.stdout).trim()}`);
  }

  return parseNameStatus(result.stdout);
}

/** Attach the changed-file list to a candidate commit (works for normal or merge commits). */
export async function loadCommitFiles(cwd: string, commit: TGitCandidateCommit): Promise<TGitCandidateCommit> {
  if (commit.kind === "merge") {
    const files = await getMergeDiffFiles(cwd, commit.hash);
    return { ...commit, files };
  }

  const result = await runGitSilent(["diff-tree", "--no-commit-id", "--name-status", "-r", commit.hash], cwd);

  if (result.exitCode !== 0) {
    return commit;
  }

  return { ...commit, files: parseNameStatus(result.stdout) };
}

export function describeMergeParents(commit: TGitCandidateCommit): { mainline: string; others: string[] } {
  const [mainline, ...others] = commit.parents;
  return { mainline: mainline ?? "", others };
}
