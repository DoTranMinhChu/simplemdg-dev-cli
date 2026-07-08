import { runGit, runGitOrThrow } from "./git-command";
import { getPorcelainStatus } from "./git-repository";
import type { TGitConflictFile, TGitConflictKind } from "./git-types";

export function classifyConflictCode(code: string): TGitConflictKind {
  switch (code) {
    case "DU":
      // Deleted by us (target already removed this file); the cherry-picked
      // commit still modifies it.
      return "modify-delete-ours";
    case "UD":
      // Deleted by them (the incoming commit deletes it); we still have it.
      return "modify-delete-theirs";
    case "UU":
      return "both-modified";
    case "AA":
      return "both-added";
    default:
      return "unknown";
  }
}

export async function getConflictFiles(cwd: string): Promise<TGitConflictFile[]> {
  const lines = await getPorcelainStatus(cwd);
  const files: TGitConflictFile[] = [];

  for (const line of lines) {
    const code = line.slice(0, 2);
    const filePath = line.slice(3).trim();

    if (!filePath) continue;
    if (!["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code)) continue;

    files.push({ path: filePath, code, kind: classifyConflictCode(code) });
  }

  return files;
}

export function describeConflictKind(kind: TGitConflictKind): string {
  switch (kind) {
    case "modify-delete-ours":
      return "The file was deleted in the target branch but modified by the cherry-picked commit. Choose whether to keep the deletion or keep the incoming file.";
    case "modify-delete-theirs":
      return "The cherry-picked commit deletes this file, but it still exists (or was modified) in the target branch. Choose whether to keep the incoming deletion or keep the target's file.";
    case "both-modified":
      return "Both sides modified this file. Git could not auto-merge the changes — resolve manually or choose a side.";
    case "both-added":
      return "Both sides added a file with this path but different content.";
    default:
      return "Unresolved merge conflict.";
  }
}

/** Keep the deletion: `git rm <file>` then the caller runs cherry-pick --continue. */
export async function keepDeletedFile(cwd: string, filePath: string): Promise<void> {
  await runGitOrThrow(["rm", "--", filePath], { cwd });
}

/** Keep the incoming (or current) working-tree content: `git add <file>`. */
export async function keepIncomingFile(cwd: string, filePath: string): Promise<void> {
  await runGitOrThrow(["add", "--", filePath], { cwd });
}

/** Search the current worktree for remaining references to a file name or symbol before deleting it. */
export async function searchUsages(cwd: string, term: string): Promise<string[]> {
  const result = await runGit(["grep", "-l", "-I", "-F", term], { cwd, announce: false });

  if (result.exitCode === 1 && !result.stdout.trim()) {
    return [];
  }

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`git grep failed: ${(result.stderr || result.stdout).trim()}`);
  }

  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}
