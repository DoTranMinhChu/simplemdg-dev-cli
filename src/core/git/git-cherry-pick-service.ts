import { runGit } from "./git-command";
import { getPorcelainStatus } from "./git-repository";
import type { TCherryPickOutcome, TGitCandidateCommit } from "./git-types";

const CONFLICT_CODES = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

const EMPTY_PATTERNS = [/is now empty/i, /nothing to commit/i, /allow-empty/i];

async function classifyOutcome(cwd: string, result: { exitCode: number; stdout: string; stderr: string }): Promise<TCherryPickOutcome> {
  if (result.exitCode === 0) {
    return { result: "success", stdout: result.stdout, stderr: result.stderr };
  }

  const combined = `${result.stdout}\n${result.stderr}`;

  const statusLines = await getPorcelainStatus(cwd);
  const hasConflictMarkers = statusLines.some((line) => CONFLICT_CODES.has(line.slice(0, 2)));

  if (hasConflictMarkers) {
    return { result: "conflict", stdout: result.stdout, stderr: result.stderr };
  }

  if (EMPTY_PATTERNS.some((pattern) => pattern.test(combined))) {
    return { result: "empty", stdout: result.stdout, stderr: result.stderr };
  }

  return { result: "failure", stdout: result.stdout, stderr: result.stderr };
}

/**
 * Cherry-pick a single commit. Normal commits use a plain cherry-pick; merge
 * commits always use `-m 1` (mainline parent) per this workflow's convention.
 */
export async function cherryPickCommit(cwd: string, commit: TGitCandidateCommit): Promise<TCherryPickOutcome> {
  const args = commit.kind === "merge" ? ["cherry-pick", "-m", "1", commit.hash] : ["cherry-pick", commit.hash];
  const result = await runGit(args, { cwd });
  return classifyOutcome(cwd, result);
}

export async function cherryPickContinue(cwd: string): Promise<TCherryPickOutcome> {
  const result = await runGit(["-c", "core.editor=true", "cherry-pick", "--continue"], { cwd });
  return classifyOutcome(cwd, result);
}

export async function cherryPickSkip(cwd: string): Promise<void> {
  const result = await runGit(["cherry-pick", "--skip"], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git cherry-pick --skip failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

export async function cherryPickAbort(cwd: string): Promise<void> {
  const result = await runGit(["cherry-pick", "--abort"], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git cherry-pick --abort failed: ${(result.stderr || result.stdout).trim()}`);
  }
}
