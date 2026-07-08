import chalk from "chalk";
import prompts from "prompts";
import { searchableSelectChoice } from "../prompts";
import { ensureExternalTool } from "../tooling";
import {
  rememberGitBuildCommand,
  rememberGitScope,
  rememberGitSourceBranch,
  rememberGitTargetBranch,
  getRememberedGitBuildCommand,
} from "../cache";
import { runGitSilent } from "./git-command";
import {
  fetchAllPruned,
  getGitRepoRoot,
  getPorcelainStatus,
  isWorkingTreeClean,
  remoteBranchExists,
} from "./git-repository";
import { buildReleaseBranchName, prepareTargetAndReleaseBranch, pushBranch } from "./git-branch-service";
import {
  dedupeCommits,
  qualifiedRange,
  resolveManualCommit,
  searchCommitsByKeyword,
  searchCommitsByPath,
  searchCommitsBySymbol,
} from "./git-scope-search";
import { describeMergeParents, loadCommitFiles } from "./git-commit-classifier";
import { cherryPickAbort, cherryPickCommit, cherryPickContinue, cherryPickSkip } from "./git-cherry-pick-service";
import { describeConflictKind, getConflictFiles, keepDeletedFile, keepIncomingFile, searchUsages } from "./git-conflict-service";
import { DEFAULT_BUILD_COMMANDS, runBuildCommand } from "./git-build-service";
import {
  checkoutFilesFromCommit,
  commitDependencyFix,
  findSourceCommitsForFile,
  findSymbolSourceCommits,
  parseBuildErrors,
  resolveMissingModuleCandidates,
} from "./git-dependency-tracer";
import type {
  TBuildIssue,
  TGitCandidateCommit,
  TGitLogRange,
  TGitMoveCodeInput,
  TGitMoveCodeRepoResult,
} from "./git-types";

function printStep(current: number, total: number, label: string): void {
  console.log("");
  console.log(chalk.bold.cyan(`Step ${current}/${total}  ${label}`));
}

export function formatCommitLine(commit: TGitCandidateCommit): string {
  const label = commit.kind === "merge" ? "[MERGE]" : "[NORMAL]";
  const colored = commit.kind === "merge" ? chalk.yellow(label.padEnd(8)) : chalk.cyan(label.padEnd(8));
  return `${colored} ${commit.shortHash} ${commit.subject}`;
}

/** Interactive: gather one or more scope searches and return the combined, deduped candidate list. */
export async function searchScopeInteractive(cwd: string, range: TGitLogRange, input: TGitMoveCodeInput): Promise<TGitCandidateCommit[]> {
  let combined: TGitCandidateCommit[] = [];

  // Non-interactive shortcut: flags were passed directly on the command line.
  if (input.scope) {
    combined = combined.concat(await searchCommitsByKeyword(cwd, range, input.scope));
  }
  if (input.path) {
    combined = combined.concat(await searchCommitsByPath(cwd, range, input.path));
  }
  if (input.symbol) {
    const { commits } = await searchCommitsBySymbol(cwd, range, input.symbol);
    combined = combined.concat(commits);
  }
  if (input.commit) {
    combined.push(await resolveManualCommit(cwd, range, input.commit));
  }

  if (combined.length) {
    return dedupeCommits(combined);
  }

  // Fully interactive mode.
  for (;;) {
    const mode = await searchableSelectChoice({
      message: "How do you want to search scope?",
      choices: [
        { title: "Keyword / Jira ticket / feature name", value: "keyword" },
        { title: "File or folder path", value: "path" },
        { title: "Symbol / class / function / type / API name", value: "symbol" },
        { title: "Manual commit hash", value: "manual" },
        ...(combined.length ? [{ title: `Done searching (${combined.length} commit(s) found)`, value: "done" }] : []),
      ],
      allowCustomValue: false,
    });

    if (mode === "done") {
      break;
    }

    try {
      if (mode === "keyword") {
        const keyword = await searchableSelectChoice({
          message: "Keyword / Jira ticket / feature name",
          choices: [],
          validateCustomValue: (value) => (value.trim() ? true : "Value is required"),
        });
        await rememberGitScope(keyword);
        combined = combined.concat(await searchCommitsByKeyword(cwd, range, keyword));
      } else if (mode === "path") {
        const pathSpec = await searchableSelectChoice({
          message: "File or folder path",
          choices: [],
          validateCustomValue: (value) => (value.trim() ? true : "Value is required"),
        });
        combined = combined.concat(await searchCommitsByPath(cwd, range, pathSpec));
      } else if (mode === "symbol") {
        const symbol = await searchableSelectChoice({
          message: "Symbol / class / function / type / API name",
          choices: [],
          validateCustomValue: (value) => (value.trim() ? true : "Value is required"),
        });
        const { files, commits } = await searchCommitsBySymbol(cwd, range, symbol);
        if (files.length) {
          console.log(chalk.gray(`Matched ${files.length} file(s) on origin/${range.source}: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""}`));
        }
        combined = combined.concat(commits);
      } else if (mode === "manual") {
        const hash = await searchableSelectChoice({
          message: "Commit hash",
          choices: [],
          validateCustomValue: (value) => (value.trim() ? true : "Value is required"),
        });
        combined.push(await resolveManualCommit(cwd, range, hash));
      }
    } catch (error) {
      console.log(chalk.yellow(error instanceof Error ? error.message : String(error)));
    }

    combined = dedupeCommits(combined);
    console.log(chalk.gray(`Found ${combined.length} candidate commit(s) so far.`));
  }

  return combined;
}

async function inspectCommitFiles(cwd: string, commit: TGitCandidateCommit): Promise<void> {
  const withFiles = await loadCommitFiles(cwd, commit);
  console.log("");
  console.log(chalk.bold(formatCommitLine(commit)));

  if (commit.kind === "merge") {
    const { mainline, others } = describeMergeParents(commit);
    console.log(chalk.gray(`Parent 1 (mainline): ${mainline}`));
    others.forEach((parent, index) => console.log(chalk.gray(`Parent ${index + 2}: ${parent}`)));
    console.log(chalk.gray("This is a merge commit. Git needs the mainline parent."));
    console.log(chalk.gray("The default for this workflow is -m 1."));
  }

  for (const file of withFiles.files ?? []) {
    console.log(`  ${file.status.padEnd(4)} ${file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}`);
  }
}

/** Recommend a selection strategy based on the mix of normal/merge candidates (spec section 6). */
function recommendCommits(commits: TGitCandidateCommit[]): TGitCandidateCommit[] {
  const normal = commits.filter((commit) => commit.kind === "normal");
  const merge = commits.filter((commit) => commit.kind === "merge");

  if (merge.length === 0) return normal;
  if (normal.length === 0) return merge;
  return commits; // mixed: recommend everything found in-range as the starting point
}

export async function selectCommitsInteractive(
  cwd: string,
  candidates: TGitCandidateCommit[],
  onSearchAgain: () => Promise<TGitCandidateCommit[]>,
): Promise<TGitCandidateCommit[] | undefined> {
  let pool = candidates;

  for (;;) {
    console.log("");
    console.log(chalk.bold(`Candidate commits (${pool.length}):`));
    pool.forEach((commit) => console.log(formatCommitLine(commit)));

    const normalCount = pool.filter((commit) => commit.kind === "normal").length;
    const mergeCount = pool.filter((commit) => commit.kind === "merge").length;

    const action = await searchableSelectChoice({
      message: "What do you want to do?",
      choices: [
        { title: "Pick recommended commits", value: "recommended" },
        { title: "Pick only normal commits", value: "normal-only" },
        { title: "Pick normal commits, then inspect merge commits", value: "normal-then-merge" },
        { title: "Manually select commits", value: "manual" },
        { title: "Inspect commit files", value: "inspect" },
        { title: "Search again", value: "search-again" },
        { title: "Abort", value: "abort" },
      ],
      allowCustomValue: false,
    });

    if (action === "abort") return undefined;

    if (action === "search-again") {
      pool = dedupeCommits(pool.concat(await onSearchAgain()));
      continue;
    }

    if (action === "inspect") {
      const hash = await searchableSelectChoice({
        message: "Inspect which commit?",
        choices: pool.map((commit) => ({ title: formatCommitLine(commit), value: commit.hash })),
        allowCustomValue: false,
      });
      const commit = pool.find((item) => item.hash === hash);
      if (commit) await inspectCommitFiles(cwd, commit);
      continue;
    }

    if (action === "recommended") {
      const recommended = recommendCommits(pool);
      if (normalCount && mergeCount) {
        console.log(chalk.gray("Mixed result: pick normal commits first, then inspect merge commits — pick a merge only if it carries additional required changes."));
      }
      return recommended;
    }

    if (action === "normal-only") {
      return pool.filter((commit) => commit.kind === "normal");
    }

    if (action === "normal-then-merge") {
      const normals = pool.filter((commit) => commit.kind === "normal");
      const merges = pool.filter((commit) => commit.kind === "merge");

      if (!merges.length) return normals;

      for (const merge of merges) {
        await inspectCommitFiles(cwd, merge);
      }

      const response = await prompts({
        type: "multiselect",
        name: "hashes",
        message: "Also include these merge commits? (they may contain additional required changes)",
        choices: merges.map((commit) => ({ title: formatCommitLine(commit), value: commit.hash })),
        hint: "Space to toggle, Enter to confirm",
      });

      const chosenHashes = new Set<string>(response.hashes ?? []);
      return [...normals, ...merges.filter((commit) => chosenHashes.has(commit.hash))];
    }

    if (action === "manual") {
      const response = await prompts({
        type: "multiselect",
        name: "hashes",
        message: "Select commits to cherry-pick",
        choices: pool.map((commit) => ({ title: formatCommitLine(commit), value: commit.hash })),
        hint: "Space to toggle, Enter to confirm",
      });

      const chosenHashes = new Set<string>(response.hashes ?? []);
      if (!chosenHashes.size) {
        console.log(chalk.yellow("No commits selected."));
        continue;
      }
      return pool.filter((commit) => chosenHashes.has(commit.hash));
    }
  }
}

/** Restore chronological (oldest-first) order for cherry-pick execution from newest-first `git log` order. */
export function toChronologicalOrder(selected: TGitCandidateCommit[], discoveryOrder: TGitCandidateCommit[]): TGitCandidateCommit[] {
  const order = new Map(discoveryOrder.map((commit, index) => [commit.hash, index]));
  return [...selected].sort((left, right) => (order.get(right.hash) ?? 0) - (order.get(left.hash) ?? 0));
}

export async function resolveConflictInteractive(cwd: string): Promise<"continue" | "abort"> {
  for (;;) {
    const conflicts = await getConflictFiles(cwd);

    if (!conflicts.length) {
      return "continue";
    }

    for (const conflict of conflicts) {
      console.log("");
      console.log(chalk.red(`Conflict: ${conflict.path} (${conflict.code})`));
      console.log(chalk.gray(describeConflictKind(conflict.kind)));

      const action = await searchableSelectChoice({
        message: `For file: ${conflict.path}`,
        choices: [
          { title: "Keep deleted file", value: "keep-deleted" },
          { title: "Keep incoming file from cherry-pick", value: "keep-incoming" },
          { title: "Show imports/usages before deciding", value: "usages" },
          { title: "Show git status", value: "status" },
          { title: "Abort cherry-pick", value: "abort" },
        ],
        allowCustomValue: false,
      });

      if (action === "usages") {
        const term = conflict.path.split("/").pop() ?? conflict.path;
        const usages = await searchUsages(cwd, term.replace(/\.[a-z0-9]+$/i, ""));
        console.log(usages.length ? usages.map((file) => `  ${file}`).join("\n") : chalk.gray("No remaining references found."));
        continue;
      }

      if (action === "status") {
        const status = await getPorcelainStatus(cwd);
        console.log(status.map((line) => `  ${line}`).join("\n"));
        continue;
      }

      if (action === "abort") {
        await cherryPickAbort(cwd);
        return "abort";
      }

      if (action === "keep-deleted") {
        await keepDeletedFile(cwd, conflict.path);
      } else if (action === "keep-incoming") {
        await keepIncomingFile(cwd, conflict.path);
      }
    }

    // All currently-known conflicts handled; try to continue. If more
    // conflicts appear, the outer loop will catch them again.
    return "continue";
  }
}

export async function executeCherryPicks(cwd: string, commits: TGitCandidateCommit[]): Promise<{ aborted: boolean }> {
  for (const commit of commits) {
    console.log("");
    console.log(chalk.bold("Picking:"));
    console.log(formatCommitLine(commit));

    for (;;) {
      const outcome = await cherryPickCommit(cwd, commit);

      if (outcome.result === "success") {
        console.log(chalk.green("Picked successfully."));
        break;
      }

      if (outcome.result === "empty") {
        console.log(chalk.yellow("This cherry-pick is empty. The changes may already exist."));
        const choice = await searchableSelectChoice({
          message: "Options",
          choices: [
            { title: "Skip", value: "skip" },
            { title: "Abort", value: "abort" },
            { title: "Inspect status", value: "status" },
          ],
          allowCustomValue: false,
        });

        if (choice === "status") {
          const status = await getPorcelainStatus(cwd);
          console.log(status.map((line) => `  ${line}`).join("\n") || chalk.gray("(clean)"));
          continue;
        }
        if (choice === "abort") {
          await cherryPickAbort(cwd);
          return { aborted: true };
        }
        await cherryPickSkip(cwd);
        break;
      }

      if (outcome.result === "conflict") {
        console.log(chalk.yellow("Conflict detected."));
        const decision = await resolveConflictInteractive(cwd);
        if (decision === "abort") {
          return { aborted: true };
        }
        const continued = await cherryPickContinue(cwd);
        if (continued.result === "success") {
          console.log(chalk.green("Picked successfully after resolving conflicts."));
          break;
        }
        if (continued.result === "conflict") {
          continue; // more conflicts surfaced; loop back into resolution
        }
        if (continued.result === "empty") {
          console.log(chalk.yellow("Resulting change is empty after conflict resolution."));
          await cherryPickSkip(cwd);
          break;
        }
        console.log(chalk.red(continued.stderr || continued.stdout));
        return { aborted: true };
      }

      // failure
      console.log(chalk.red("Cherry-pick failed."));
      console.log(chalk.gray(outcome.stderr || outcome.stdout));
      const status = await getPorcelainStatus(cwd);
      console.log(status.map((line) => `  ${line}`).join("\n"));

      const choice = await searchableSelectChoice({
        message: "How do you want to proceed?",
        choices: [
          { title: "Skip this commit (git cherry-pick --skip)", value: "skip" },
          { title: "Abort remaining picks (git cherry-pick --abort)", value: "abort" },
        ],
        allowCustomValue: false,
      });

      if (choice === "abort") {
        await cherryPickAbort(cwd);
        return { aborted: true };
      }
      await cherryPickSkip(cwd);
      break;
    }
  }

  return { aborted: false };
}

async function resolveBuildCommand(cwd: string, input: TGitMoveCodeInput): Promise<string | undefined> {
  if (input.buildCommand) return input.buildCommand;

  const remembered = await getRememberedGitBuildCommand(cwd);
  const choices = [
    ...(remembered ? [{ title: `${remembered} (remembered for this repo)`, value: remembered }] : []),
    ...DEFAULT_BUILD_COMMANDS.filter((command) => command !== remembered).map((command) => ({ title: command, value: command })),
    { title: "Custom command", value: "__custom__" },
    { title: "Skip build", value: "__skip__" },
  ];

  const choice = await searchableSelectChoice({
    message: "Build command",
    choices,
    allowCustomValue: false,
  });

  if (choice === "__skip__") return undefined;

  if (choice === "__custom__") {
    const response = await prompts({ type: "text", name: "command", message: "Custom build command", validate: (value: string) => (value.trim() ? true : "Value is required") });
    if (!response.command) return undefined;
    return String(response.command).trim();
  }

  return choice;
}

/** Run the build command and, on failure, interactively trace + fix missing dependencies; re-runs until it passes or the user stops. */
export async function runBuildAndTraceDependencies(cwd: string, range: TGitLogRange, scope: string, buildCommand: string): Promise<boolean> {
  for (;;) {
    console.log(chalk.gray(`Running: ${buildCommand}`));
    const build = await runBuildCommand(cwd, buildCommand);

    if (build.success) {
      console.log(chalk.green("Build: PASS"));
      return true;
    }

    console.log(chalk.red("Build: FAIL"));
    const combinedOutput = `${build.stdout}\n${build.stderr}`;
    const issues = parseBuildErrors(combinedOutput);

    if (!issues.length) {
      console.log(chalk.gray(combinedOutput.slice(0, 4000)));
      const proceed = await searchableSelectChoice({
        message: "Build failed and no known dependency pattern was recognized. What next?",
        choices: [
          { title: "Retry build", value: "retry" },
          { title: "Continue anyway (leave build failing)", value: "continue" },
          { title: "Abort workflow", value: "abort" },
        ],
        allowCustomValue: false,
      });
      if (proceed === "retry") continue;
      if (proceed === "abort") throw new Error("Aborted after unrecognized build failure.");
      return false;
    }

    let fixedAny = false;

    for (const issue of issues) {
      const fixed = await traceAndFixDependency(cwd, range, scope, issue);
      fixedAny = fixedAny || fixed;
    }

    if (!fixedAny) {
      const proceed = await searchableSelectChoice({
        message: "No dependency fixes were applied. Retry build, continue anyway, or abort?",
        choices: [
          { title: "Retry build", value: "retry" },
          { title: "Continue anyway (leave build failing)", value: "continue" },
          { title: "Abort workflow", value: "abort" },
        ],
        allowCustomValue: false,
      });
      if (proceed === "retry") continue;
      if (proceed === "abort") throw new Error("Aborted after failed dependency trace.");
      return false;
    }
  }
}

async function traceAndFixDependency(cwd: string, range: TGitLogRange, scope: string, issue: TBuildIssue): Promise<boolean> {
  if (issue.kind === "missing-module") {
    console.log("");
    console.log(chalk.yellow(`Missing module: '${issue.importPath}'${issue.importerFile ? ` (imported from ${issue.importerFile})` : ""}`));
    const candidateFiles = await resolveMissingModuleCandidates(cwd, range.source, issue);

    if (!candidateFiles.length) {
      console.log(chalk.gray("Could not resolve a candidate file on the source branch."));
      return false;
    }

    return offerDependencyFix(cwd, range, scope, candidateFiles, `Add missing dependency for ${scope}`);
  }

  if (issue.kind === "type-mismatch" && issue.symbol) {
    console.log("");
    console.log(chalk.yellow(`Type/member mismatch: ${issue.message}`));
    const { files } = await findSymbolSourceCommits(cwd, range, issue.symbol);

    if (!files.length) {
      console.log(chalk.gray(`No files on origin/${range.source} reference '${issue.symbol}'.`));
      return false;
    }

    return offerDependencyFix(cwd, range, scope, files, `Align ${issue.symbol} dependencies for ${scope}`);
  }

  console.log(chalk.gray(`Unrecognized build issue: ${issue.kind === "unknown" ? issue.message : ""}`));
  return false;
}

async function offerDependencyFix(cwd: string, range: TGitLogRange, scope: string, files: string[], defaultMessage: string): Promise<boolean> {
  // Find the most relevant (most recent) source commit touching any candidate file.
  let bestCommit: TGitCandidateCommit | undefined;
  let bestFiles: string[] = [];

  for (const file of files) {
    const commits = await findSourceCommitsForFile(cwd, range, file);
    if (commits.length) {
      bestCommit = bestCommit ?? commits[0];
      if (commits[0].hash === bestCommit.hash) bestFiles.push(file);
    }
  }

  if (!bestCommit) {
    console.log(chalk.gray(`No source commits found for: ${files.join(", ")}`));
    return false;
  }

  console.log("");
  console.log(chalk.bold("Found dependency source commit:"));
  console.log(formatCommitLine(bestCommit));
  console.log("Files:");
  bestFiles.forEach((file) => console.log(`  A ${file}`));

  const action = await searchableSelectChoice({
    message: "How do you want to add the missing dependency?",
    choices: [
      { title: "Checkout selected missing files (recommended)", value: "checkout-files" },
      { title: "Inspect commit", value: "inspect" },
      { title: "Cherry-pick entire commit", value: "cherry-pick" },
      { title: "Skip", value: "skip" },
      { title: "Abort workflow", value: "abort" },
    ],
    allowCustomValue: false,
  });

  if (action === "abort") throw new Error("Aborted during dependency tracing.");
  if (action === "skip") return false;

  if (action === "inspect") {
    await inspectCommitFiles(cwd, bestCommit);
    return offerDependencyFix(cwd, range, scope, files, defaultMessage);
  }

  if (action === "cherry-pick") {
    console.log(chalk.yellow("Cherry-picking the entire dependency commit may pull unrelated scope."));
    const outcome = await cherryPickCommit(cwd, bestCommit);
    if (outcome.result === "conflict") {
      const decision = await resolveConflictInteractive(cwd);
      if (decision === "abort") return false;
      await cherryPickContinue(cwd);
    }
    return outcome.result === "success" || outcome.result === "conflict";
  }

  // checkout-files (default/recommended)
  await checkoutFilesFromCommit(cwd, bestCommit.hash, bestFiles);
  const response = await prompts({ type: "text", name: "message", message: "Commit message", initial: defaultMessage });
  await commitDependencyFix(cwd, String(response.message || defaultMessage));
  console.log(chalk.green("Dependency fix committed."));
  return true;
}

export async function showSummaryAndPush(cwd: string, targetBranch: string, releaseBranch: string): Promise<void> {
  console.log("");
  console.log(chalk.bold("Release branch:"));
  console.log(releaseBranch);

  const log = await runGitSilent(["log", `origin/${targetBranch}..HEAD`, "--oneline"], cwd);
  console.log("");
  console.log(chalk.bold("Commits ahead of target:"));
  console.log(log.stdout.trim() || chalk.gray("(none)"));

  const diff = await runGitSilent(["diff", `origin/${targetBranch}..HEAD`, "--name-status"], cwd);
  console.log("");
  console.log(chalk.bold("Changed files:"));
  console.log(diff.stdout.trim() || chalk.gray("(none)"));

  const status = await getPorcelainStatus(cwd);
  if (status.length) {
    console.log("");
    console.log(chalk.bold("Working tree status:"));
    console.log(status.map((line) => `  ${line}`).join("\n"));
  }

  const confirmPush = await searchableSelectChoice({
    message: "Push release branch to origin?",
    choices: [
      { title: "Yes", value: "yes" },
      { title: "No", value: "no" },
    ],
    allowCustomValue: false,
  });

  if (confirmPush !== "yes") {
    console.log(chalk.gray("Not pushed. You can push later with:"));
    console.log(chalk.gray(`  git push origin ${releaseBranch} --set-upstream`));
    return;
  }

  await pushBranch(cwd, releaseBranch);
  console.log(chalk.green(`Pushed ${releaseBranch} to origin.`));
  console.log("");
  console.log(chalk.bold("Create merge request:"));
  console.log(`${releaseBranch} -> ${targetBranch}`);
}

export async function runMoveCodeForRepository(repositoryPathInput: string, input: TGitMoveCodeInput): Promise<TGitMoveCodeRepoResult> {
  await ensureExternalTool("git");
  const cwd = await getGitRepoRoot(repositoryPathInput);

  console.log(chalk.bold("SimpleMDG Move Code Assistant"));
  console.log(chalk.gray(`Repository: ${cwd}`));
  console.log(chalk.gray(`Source: ${input.sourceBranch}`));
  console.log(chalk.gray(`Target: ${input.targetBranch}`));
  if (input.scope) console.log(chalk.gray(`Scope: ${input.scope}`));
  if (input.dryRun) console.log(chalk.yellow("Dry-run mode: no branch will be created, no cherry-picks will run."));

  const totalSteps = 8;

  printStep(1, totalSteps, "Fetch branches");
  await fetchAllPruned(cwd);

  if (!(await remoteBranchExists(cwd, input.sourceBranch))) {
    throw new Error(`Source branch not found on origin: ${input.sourceBranch}`);
  }
  if (!(await remoteBranchExists(cwd, input.targetBranch))) {
    throw new Error(`Target branch not found on origin: ${input.targetBranch}`);
  }

  await rememberGitSourceBranch(input.sourceBranch);
  await rememberGitTargetBranch(input.targetBranch);

  if (!(await isWorkingTreeClean(cwd))) {
    if (input.dryRun) {
      console.log(chalk.yellow("Working tree is not clean (ignored in dry-run mode)."));
    } else {
      throw new Error("Working tree is not clean. Commit, stash, or discard changes before moving code.");
    }
  }

  const range: TGitLogRange = { source: input.sourceBranch, target: input.targetBranch };

  printStep(2, totalSteps, "Search commits");
  let discoveryOrder = await searchScopeInteractive(cwd, range, input);
  discoveryOrder = dedupeCommits(discoveryOrder);

  if (!discoveryOrder.length) {
    console.log(chalk.yellow(`No candidate commits found for ${qualifiedRange(range)}.`));
    return { repositoryPath: cwd, status: "NO MATCH" };
  }

  printStep(3, totalSteps, "Select commits");
  const selected = await selectCommitsInteractive(cwd, discoveryOrder, () => searchScopeInteractive(cwd, range, {
    ...input,
    scope: undefined,
    path: undefined,
    symbol: undefined,
    commit: undefined,
  }));

  if (!selected || !selected.length) {
    console.log(chalk.yellow("Aborted before selecting commits."));
    return { repositoryPath: cwd, status: "ABORTED" };
  }

  const scopeLabel = input.scope || input.path || input.symbol || input.commit || "code";
  const releaseBranchName = buildReleaseBranchName(scopeLabel, input.targetBranch);
  const chronological = toChronologicalOrder(selected, discoveryOrder);

  if (input.dryRun) {
    console.log("");
    console.log(chalk.bold("Dry-run plan:"));
    console.log(`Would create release branch: ${releaseBranchName} (from ${input.targetBranch})`);
    console.log("Would cherry-pick, in order:");
    chronological.forEach((commit) => console.log(`  ${formatCommitLine(commit)}`));
    return { repositoryPath: cwd, status: "DRY-RUN", releaseBranch: releaseBranchName };
  }

  printStep(4, totalSteps, "Create release branch");
  const { branch: releaseBranch } = await prepareTargetAndReleaseBranch({
    cwd,
    targetBranch: input.targetBranch,
    releaseBranchName,
    onExisting: async (branch) => {
      const choice = await searchableSelectChoice({
        message: `Branch '${branch}' already exists. What do you want to do?`,
        choices: [
          { title: "Use existing branch", value: "reuse" },
          { title: "Recreate branch (delete + recreate from target)", value: "recreate" },
          { title: "Input another branch name", value: "rename" },
          { title: "Abort", value: "abort" },
        ],
        allowCustomValue: false,
      });

      if (choice === "rename") {
        const response = await prompts({ type: "text", name: "name", message: "New release branch name", validate: (value: string) => (value.trim() ? true : "Value is required") });
        if (!response.name) return "abort";
        return { rename: String(response.name) };
      }

      return choice as "reuse" | "recreate" | "abort";
    },
  });

  printStep(5, totalSteps, "Cherry-pick");
  const pickResult = await executeCherryPicks(cwd, chronological);

  if (pickResult.aborted) {
    return { repositoryPath: cwd, status: "CONFLICT", releaseBranch, message: "Cherry-pick aborted." };
  }

  printStep(6, totalSteps, "Build");
  const buildCommand = await resolveBuildCommand(cwd, input);
  let buildPassed = true;

  if (buildCommand) {
    await rememberGitBuildCommand(cwd, buildCommand);
    printStep(7, totalSteps, "Trace dependencies");
    buildPassed = await runBuildAndTraceDependencies(cwd, range, scopeLabel, buildCommand);
  } else {
    console.log(chalk.gray("Build skipped."));
  }

  printStep(8, totalSteps, "Summary");
  await showSummaryAndPush(cwd, input.targetBranch, releaseBranch);

  return {
    repositoryPath: cwd,
    status: buildPassed ? "PASS" : "CONFLICT",
    releaseBranch,
    message: buildPassed ? undefined : "Build did not pass.",
  };
}

export async function runMoveCodeWorkflow(input: TGitMoveCodeInput, repositoryPaths?: string[]): Promise<TGitMoveCodeRepoResult[]> {
  const paths = repositoryPaths && repositoryPaths.length ? repositoryPaths : [input.cwd ?? process.cwd()];
  const results: TGitMoveCodeRepoResult[] = [];

  for (const repoPath of paths) {
    if (paths.length > 1) {
      console.log("");
      console.log(chalk.bold.underline(`Repository: ${repoPath}`));
    }

    try {
      const result = await runMoveCodeForRepository(repoPath, input);
      results.push(result);
    } catch (error) {
      results.push({ repositoryPath: repoPath, status: "ABORTED", message: error instanceof Error ? error.message : String(error) });
      console.log(chalk.red(error instanceof Error ? error.message : String(error)));
    }
  }

  if (paths.length > 1) {
    console.log("");
    console.log(chalk.bold("Multi-repository summary:"));
    const nameWidth = Math.max(4, ...results.map((result) => result.repositoryPath.length));
    for (const result of results) {
      console.log(`${result.repositoryPath.padEnd(nameWidth)}  ${result.status}`);
    }
  }

  return results;
}
