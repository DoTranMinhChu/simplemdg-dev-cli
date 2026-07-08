import { runGit, runGitOrThrow } from "./git-command";
import { fetchAllPruned, localBranchExists, remoteBranchExists } from "./git-repository";

export { fetchAllPruned };

/** Sanitize one branch-name segment: spaces -> dashes, strip characters git branch names disallow. */
export function sanitizeBranchSegment(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[~^:?*\[\]\\]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-/.]+|[-/.]+$/g, "")
    .slice(0, 80);
}

export function buildReleaseBranchName(scope: string, target: string): string {
  const scopeSegment = sanitizeBranchSegment(scope) || "code";
  const targetSegment = sanitizeBranchSegment(target) || "target";
  return `release/${scopeSegment}-to-${targetSegment}`;
}

export async function checkoutBranch(cwd: string, branch: string): Promise<void> {
  await runGitOrThrow(["checkout", branch], { cwd });
}

export async function pullCurrentBranch(cwd: string): Promise<void> {
  const result = await runGit(["pull"], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git pull failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

export async function deleteLocalBranch(cwd: string, branch: string): Promise<void> {
  await runGitOrThrow(["branch", "-D", branch], { cwd });
}

export async function createBranchFrom(cwd: string, branch: string, from: string): Promise<void> {
  await runGitOrThrow(["checkout", "-b", branch, from], { cwd });
}

export async function pushBranch(cwd: string, branch: string): Promise<void> {
  await runGitOrThrow(["push", "origin", branch, "--set-upstream"], { cwd });
}

export type TReleaseBranchAction = "created" | "reused" | "recreated";

/**
 * Ensure the target branch is up to date, then create (or reuse) the release
 * branch FROM the target branch. Never creates it from the source branch —
 * that's a hard safety rule for this workflow.
 */
export async function prepareTargetAndReleaseBranch(options: {
  cwd: string;
  targetBranch: string;
  releaseBranchName: string;
  onExisting: (branch: string) => Promise<"reuse" | "recreate" | { rename: string } | "abort">;
}): Promise<{ branch: string; action: TReleaseBranchAction }> {
  const { cwd, targetBranch, releaseBranchName } = options;

  if (!(await remoteBranchExists(cwd, targetBranch))) {
    throw new Error(`Target branch not found on origin: ${targetBranch}`);
  }

  await checkoutBranch(cwd, targetBranch);
  await pullCurrentBranch(cwd);

  let branch = releaseBranchName;

  for (;;) {
    const exists = await localBranchExists(cwd, branch);

    if (!exists) {
      await createBranchFrom(cwd, branch, targetBranch);
      return { branch, action: "created" };
    }

    const decision = await options.onExisting(branch);

    if (decision === "reuse") {
      await checkoutBranch(cwd, branch);
      return { branch, action: "reused" };
    }

    if (decision === "recreate") {
      await checkoutBranch(cwd, targetBranch);
      await deleteLocalBranch(cwd, branch);
      await createBranchFrom(cwd, branch, targetBranch);
      return { branch, action: "recreated" };
    }

    if (decision === "abort") {
      throw new Error("Aborted: release branch already exists.");
    }

    branch = sanitizeBranchSegment(decision.rename) || branch;
  }
}
