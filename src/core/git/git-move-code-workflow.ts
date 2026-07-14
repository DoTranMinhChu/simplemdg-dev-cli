import chalk from "chalk";
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
  TWorkflowContext,
} from "./git-types";

/** Rethrow if the whole workflow was cancelled (Ctrl+C); otherwise this was just the user
 * backing out of one sub-prompt (Escape), so the caller should keep going / retry. */
function isWholeWorkflowCancelled(ctx: TWorkflowContext): boolean {
  return ctx.signal.aborted;
}

export function formatCommitLine(commit: TGitCandidateCommit): string {
  const label = commit.kind === "merge" ? "[MERGE]" : "[NORMAL]";
  const colored = commit.kind === "merge" ? chalk.yellow(label.padEnd(8)) : chalk.cyan(label.padEnd(8));
  return `${colored} ${commit.shortHash} ${commit.subject}`;
}

/** Interactive: gather one or more scope searches and return the combined, deduped candidate list. */
export async function searchScopeInteractive(cwd: string, range: TGitLogRange, input: TGitMoveCodeInput, ctx: TWorkflowContext): Promise<TGitCandidateCommit[]> {
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
    const mode = await ctx.interaction.select({
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
        const keyword = await ctx.interaction.input({
          message: "Keyword / Jira ticket / feature name",
          validate: (value) => (value.trim() ? true : "Value is required"),
        });
        await rememberGitScope(keyword);
        combined = combined.concat(await searchCommitsByKeyword(cwd, range, keyword));
      } else if (mode === "path") {
        const pathSpec = await ctx.interaction.input({
          message: "File or folder path",
          validate: (value) => (value.trim() ? true : "Value is required"),
        });
        combined = combined.concat(await searchCommitsByPath(cwd, range, pathSpec));
      } else if (mode === "symbol") {
        const symbol = await ctx.interaction.input({
          message: "Symbol / class / function / type / API name",
          validate: (value) => (value.trim() ? true : "Value is required"),
        });
        const { files, commits } = await searchCommitsBySymbol(cwd, range, symbol);
        if (files.length) {
          ctx.interaction.notify({
            level: "muted",
            message: `Matched ${files.length} file(s) on origin/${range.source}: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""}`,
          });
        }
        combined = combined.concat(commits);
      } else if (mode === "manual") {
        const hash = await ctx.interaction.input({
          message: "Commit hash",
          validate: (value) => (value.trim() ? true : "Value is required"),
        });
        combined.push(await resolveManualCommit(cwd, range, hash));
      }
    } catch (error) {
      if (isWholeWorkflowCancelled(ctx)) {
        throw error;
      }
      ctx.interaction.notify({ level: "warn", message: error instanceof Error ? error.message : String(error) });
    }

    combined = dedupeCommits(combined);
    ctx.interaction.notify({ level: "muted", message: `Found ${combined.length} candidate commit(s) so far.` });
  }

  return combined;
}

async function inspectCommitFiles(cwd: string, commit: TGitCandidateCommit, ctx: TWorkflowContext): Promise<void> {
  const withFiles = await loadCommitFiles(cwd, commit);
  const lines: string[] = [formatCommitLine(commit)];

  if (commit.kind === "merge") {
    const { mainline, others } = describeMergeParents(commit);
    lines.push(chalk.gray(`Parent 1 (mainline): ${mainline}`));
    others.forEach((parent, index) => lines.push(chalk.gray(`Parent ${index + 2}: ${parent}`)));
    lines.push(chalk.gray("This is a merge commit. Git needs the mainline parent."));
    lines.push(chalk.gray("The default for this workflow is -m 1."));
  }

  for (const file of withFiles.files ?? []) {
    lines.push(`  ${file.status.padEnd(4)} ${file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}`);
  }

  ctx.interaction.notify({ level: "info", message: lines.join("\n") });
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
  ctx: TWorkflowContext,
): Promise<TGitCandidateCommit[] | undefined> {
  let pool = candidates;

  for (;;) {
    ctx.interaction.notify({
      level: "info",
      message: [chalk.bold(`Candidate commits (${pool.length}):`), ...pool.map((commit) => formatCommitLine(commit))].join("\n"),
    });

    const normalCount = pool.filter((commit) => commit.kind === "normal").length;
    const mergeCount = pool.filter((commit) => commit.kind === "merge").length;

    const action = await ctx.interaction.select({
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
      const hash = await ctx.interaction.select({
        message: "Inspect which commit?",
        choices: pool.map((commit) => ({ title: formatCommitLine(commit), value: commit.hash })),
        allowCustomValue: false,
      });
      const commit = pool.find((item) => item.hash === hash);
      if (commit) await inspectCommitFiles(cwd, commit, ctx);
      continue;
    }

    if (action === "recommended") {
      const recommended = recommendCommits(pool);
      if (normalCount && mergeCount) {
        ctx.interaction.notify({
          level: "muted",
          message: "Mixed result: pick normal commits first, then inspect merge commits — pick a merge only if it carries additional required changes.",
        });
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
        await inspectCommitFiles(cwd, merge, ctx);
      }

      const chosenHashes = await ctx.interaction.multiSelect({
        message: "Also include these merge commits? (they may contain additional required changes)",
        choices: merges.map((commit) => ({ title: formatCommitLine(commit), value: commit.hash })),
        hint: "Space to toggle, Enter to confirm",
      });

      const chosenHashSet = new Set(chosenHashes);
      return [...normals, ...merges.filter((commit) => chosenHashSet.has(commit.hash))];
    }

    if (action === "manual") {
      const chosenHashes = await ctx.interaction.multiSelect({
        message: "Select commits to cherry-pick",
        choices: pool.map((commit) => ({ title: formatCommitLine(commit), value: commit.hash })),
        hint: "Space to toggle, Enter to confirm",
      });

      const chosenHashSet = new Set(chosenHashes);
      if (!chosenHashSet.size) {
        ctx.interaction.notify({ level: "warn", message: "No commits selected." });
        continue;
      }
      return pool.filter((commit) => chosenHashSet.has(commit.hash));
    }
  }
}

/** Restore chronological (oldest-first) order for cherry-pick execution from newest-first `git log` order. */
export function toChronologicalOrder(selected: TGitCandidateCommit[], discoveryOrder: TGitCandidateCommit[]): TGitCandidateCommit[] {
  const order = new Map(discoveryOrder.map((commit, index) => [commit.hash, index]));
  return [...selected].sort((left, right) => (order.get(right.hash) ?? 0) - (order.get(left.hash) ?? 0));
}

export async function resolveConflictInteractive(cwd: string, ctx: TWorkflowContext): Promise<"continue" | "abort"> {
  for (;;) {
    const conflicts = await getConflictFiles(cwd);

    if (!conflicts.length) {
      return "continue";
    }

    for (const conflict of conflicts) {
      ctx.interaction.notify({
        level: "error",
        message: `Conflict: ${conflict.path} (${conflict.code})\n${chalk.gray(describeConflictKind(conflict.kind))}`,
      });

      const action = await ctx.interaction.select({
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
        ctx.interaction.notify({
          level: "info",
          message: usages.length ? usages.map((file) => `  ${file}`).join("\n") : chalk.gray("No remaining references found."),
        });
        continue;
      }

      if (action === "status") {
        const status = await getPorcelainStatus(cwd);
        ctx.interaction.notify({ level: "info", message: status.map((line) => `  ${line}`).join("\n") });
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

export async function executeCherryPicks(cwd: string, commits: TGitCandidateCommit[], ctx: TWorkflowContext): Promise<{ aborted: boolean }> {
  return ctx.interaction.progress({ label: "Cherry-picking" }, async (report) => {
    for (let index = 0; index < commits.length; index += 1) {
      const commit = commits[index];
      report({ current: index + 1, total: commits.length, label: `Cherry-picking ${commit.shortHash}` });
      ctx.interaction.notify({ level: "info", message: `Picking:\n${formatCommitLine(commit)}` });

      for (;;) {
        const outcome = await cherryPickCommit(cwd, commit);

        if (outcome.result === "success") {
          ctx.interaction.notify({ level: "success", message: "Picked successfully." });
          break;
        }

        if (outcome.result === "empty") {
          ctx.interaction.notify({ level: "warn", message: "This cherry-pick is empty. The changes may already exist." });
          const choice = await ctx.interaction.select({
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
            ctx.interaction.notify({ level: "info", message: status.map((line) => `  ${line}`).join("\n") || chalk.gray("(clean)") });
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
          ctx.interaction.notify({ level: "warn", message: "Conflict detected." });
          const decision = await resolveConflictInteractive(cwd, ctx);
          if (decision === "abort") {
            return { aborted: true };
          }
          const continued = await cherryPickContinue(cwd);
          if (continued.result === "success") {
            ctx.interaction.notify({ level: "success", message: "Picked successfully after resolving conflicts." });
            break;
          }
          if (continued.result === "conflict") {
            continue; // more conflicts surfaced; loop back into resolution
          }
          if (continued.result === "empty") {
            ctx.interaction.notify({ level: "warn", message: "Resulting change is empty after conflict resolution." });
            await cherryPickSkip(cwd);
            break;
          }
          ctx.interaction.notify({ level: "error", message: continued.stderr || continued.stdout });
          return { aborted: true };
        }

        // failure
        ctx.interaction.notify({ level: "error", message: "Cherry-pick failed." });
        const status = await getPorcelainStatus(cwd);
        ctx.interaction.notify({ level: "muted", message: `${outcome.stderr || outcome.stdout}\n${status.map((line) => `  ${line}`).join("\n")}` });

        const choice = await ctx.interaction.select({
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
  });
}

async function resolveBuildCommand(cwd: string, input: TGitMoveCodeInput, ctx: TWorkflowContext): Promise<string | undefined> {
  if (input.buildCommand) return input.buildCommand;

  const remembered = await getRememberedGitBuildCommand(cwd);
  const choices = [
    ...(remembered ? [{ title: `${remembered} (remembered for this repo)`, value: remembered }] : []),
    ...DEFAULT_BUILD_COMMANDS.filter((command) => command !== remembered).map((command) => ({ title: command, value: command })),
    { title: "Custom command", value: "__custom__" },
    { title: "Skip build", value: "__skip__" },
  ];

  const choice = await ctx.interaction.select({
    message: "Build command",
    choices,
    allowCustomValue: false,
  });

  if (choice === "__skip__") return undefined;

  if (choice === "__custom__") {
    try {
      return await ctx.interaction.input({
        message: "Custom build command",
        validate: (value) => (value.trim() ? true : "Value is required"),
      });
    } catch {
      return undefined; // cancelled — original behavior treats this the same as "skip build"
    }
  }

  return choice;
}

/** Run the build command and, on failure, interactively trace + fix missing dependencies; re-runs until it passes or the user stops. */
export async function runBuildAndTraceDependencies(cwd: string, range: TGitLogRange, scope: string, buildCommand: string, ctx: TWorkflowContext): Promise<boolean> {
  for (;;) {
    ctx.interaction.notify({ level: "muted", message: `Running: ${buildCommand}` });
    const build = await runBuildCommand(cwd, buildCommand, ctx.signal);

    if (build.success) {
      ctx.interaction.notify({ level: "success", message: "Build: PASS" });
      return true;
    }

    ctx.interaction.notify({ level: "error", message: "Build: FAIL" });
    const combinedOutput = `${build.stdout}\n${build.stderr}`;
    const issues = parseBuildErrors(combinedOutput);

    if (!issues.length) {
      ctx.interaction.notify({ level: "muted", message: combinedOutput.slice(0, 4000) });
      const proceed = await ctx.interaction.select({
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
      const fixed = await traceAndFixDependency(cwd, range, scope, issue, ctx);
      fixedAny = fixedAny || fixed;
    }

    if (!fixedAny) {
      const proceed = await ctx.interaction.select({
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

async function traceAndFixDependency(cwd: string, range: TGitLogRange, scope: string, issue: TBuildIssue, ctx: TWorkflowContext): Promise<boolean> {
  if (issue.kind === "missing-module") {
    ctx.interaction.notify({
      level: "warn",
      message: `Missing module: '${issue.importPath}'${issue.importerFile ? ` (imported from ${issue.importerFile})` : ""}`,
    });
    const candidateFiles = await resolveMissingModuleCandidates(cwd, range.source, issue);

    if (!candidateFiles.length) {
      ctx.interaction.notify({ level: "muted", message: "Could not resolve a candidate file on the source branch." });
      return false;
    }

    return offerDependencyFix(cwd, range, scope, candidateFiles, `Add missing dependency for ${scope}`, ctx);
  }

  if (issue.kind === "type-mismatch" && issue.symbol) {
    ctx.interaction.notify({ level: "warn", message: `Type/member mismatch: ${issue.message}` });
    const { files } = await findSymbolSourceCommits(cwd, range, issue.symbol);

    if (!files.length) {
      ctx.interaction.notify({ level: "muted", message: `No files on origin/${range.source} reference '${issue.symbol}'.` });
      return false;
    }

    return offerDependencyFix(cwd, range, scope, files, `Align ${issue.symbol} dependencies for ${scope}`, ctx);
  }

  ctx.interaction.notify({ level: "muted", message: `Unrecognized build issue: ${issue.kind === "unknown" ? issue.message : ""}` });
  return false;
}

async function offerDependencyFix(cwd: string, range: TGitLogRange, scope: string, files: string[], defaultMessage: string, ctx: TWorkflowContext): Promise<boolean> {
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
    ctx.interaction.notify({ level: "muted", message: `No source commits found for: ${files.join(", ")}` });
    return false;
  }

  ctx.interaction.notify({
    level: "info",
    message: [chalk.bold("Found dependency source commit:"), formatCommitLine(bestCommit), "Files:", ...bestFiles.map((file) => `  A ${file}`)].join("\n"),
  });

  const action = await ctx.interaction.select({
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
    await inspectCommitFiles(cwd, bestCommit, ctx);
    return offerDependencyFix(cwd, range, scope, files, defaultMessage, ctx);
  }

  if (action === "cherry-pick") {
    ctx.interaction.notify({ level: "warn", message: "Cherry-picking the entire dependency commit may pull unrelated scope." });
    const outcome = await cherryPickCommit(cwd, bestCommit);
    if (outcome.result === "conflict") {
      const decision = await resolveConflictInteractive(cwd, ctx);
      if (decision === "abort") return false;
      await cherryPickContinue(cwd);
    }
    return outcome.result === "success" || outcome.result === "conflict";
  }

  // checkout-files (default/recommended)
  await checkoutFilesFromCommit(cwd, bestCommit.hash, bestFiles);
  let message: string;
  try {
    message = await ctx.interaction.input({ message: "Commit message", initial: defaultMessage });
  } catch {
    message = defaultMessage; // cancelled — original behavior falls back to the default message rather than aborting
  }
  await commitDependencyFix(cwd, message || defaultMessage);
  ctx.interaction.notify({ level: "success", message: "Dependency fix committed." });
  return true;
}

export async function showSummaryAndPush(cwd: string, targetBranch: string, releaseBranch: string, ctx: TWorkflowContext): Promise<void> {
  const log = await runGitSilent(["log", `origin/${targetBranch}..HEAD`, "--oneline"], cwd);
  const diff = await runGitSilent(["diff", `origin/${targetBranch}..HEAD`, "--name-status"], cwd);
  const status = await getPorcelainStatus(cwd);

  const summaryLines = [
    chalk.bold("Release branch:"),
    releaseBranch,
    "",
    chalk.bold("Commits ahead of target:"),
    log.stdout.trim() || chalk.gray("(none)"),
    "",
    chalk.bold("Changed files:"),
    diff.stdout.trim() || chalk.gray("(none)"),
  ];

  if (status.length) {
    summaryLines.push("", chalk.bold("Working tree status:"), status.map((line) => `  ${line}`).join("\n"));
  }

  ctx.interaction.notify({ level: "info", message: summaryLines.join("\n") });

  const confirmPush = await ctx.interaction.confirm({ message: "Push release branch to origin?" });

  if (!confirmPush) {
    ctx.interaction.notify({
      level: "muted",
      message: `Not pushed. You can push later with:\n  git push origin ${releaseBranch} --set-upstream`,
    });
    return;
  }

  await pushBranch(cwd, releaseBranch);
  ctx.interaction.notify({
    level: "success",
    message: `Pushed ${releaseBranch} to origin.\n\nCreate merge request:\n${releaseBranch} -> ${targetBranch}`,
  });
}

export async function runMoveCodeForRepository(repositoryPathInput: string, input: TGitMoveCodeInput, ctx: TWorkflowContext): Promise<TGitMoveCodeRepoResult> {
  await ensureExternalTool("git");
  const cwd = await getGitRepoRoot(repositoryPathInput);

  const introLines = [chalk.bold("SimpleMDG Move Code Assistant"), chalk.gray(`Repository: ${cwd}`), chalk.gray(`Source: ${input.sourceBranch}`), chalk.gray(`Target: ${input.targetBranch}`)];
  if (input.scope) introLines.push(chalk.gray(`Scope: ${input.scope}`));
  if (input.dryRun) introLines.push(chalk.yellow("Dry-run mode: no branch will be created, no cherry-picks will run."));
  ctx.interaction.notify({ level: "info", message: introLines.join("\n") });

  const totalSteps = 8;

  ctx.interaction.notify({ level: "step", message: "Fetch branches", current: 1, total: totalSteps });
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
      ctx.interaction.notify({ level: "warn", message: "Working tree is not clean (ignored in dry-run mode)." });
    } else {
      throw new Error("Working tree is not clean. Commit, stash, or discard changes before moving code.");
    }
  }

  const range: TGitLogRange = { source: input.sourceBranch, target: input.targetBranch };

  ctx.interaction.notify({ level: "step", message: "Search commits", current: 2, total: totalSteps });
  let discoveryOrder = await searchScopeInteractive(cwd, range, input, ctx);
  discoveryOrder = dedupeCommits(discoveryOrder);

  if (!discoveryOrder.length) {
    ctx.interaction.notify({ level: "warn", message: `No candidate commits found for ${qualifiedRange(range)}.` });
    return { repositoryPath: cwd, status: "NO MATCH" };
  }

  ctx.interaction.notify({ level: "step", message: "Select commits", current: 3, total: totalSteps });
  const selected = await selectCommitsInteractive(
    cwd,
    discoveryOrder,
    () => searchScopeInteractive(cwd, range, { ...input, scope: undefined, path: undefined, symbol: undefined, commit: undefined }, ctx),
    ctx,
  );

  if (!selected || !selected.length) {
    ctx.interaction.notify({ level: "warn", message: "Aborted before selecting commits." });
    return { repositoryPath: cwd, status: "ABORTED" };
  }

  const scopeLabel = input.scope || input.path || input.symbol || input.commit || "code";
  const releaseBranchName = buildReleaseBranchName(scopeLabel, input.targetBranch);
  const chronological = toChronologicalOrder(selected, discoveryOrder);

  if (input.dryRun) {
    const planLines = [chalk.bold("Dry-run plan:"), `Would create release branch: ${releaseBranchName} (from ${input.targetBranch})`, "Would cherry-pick, in order:"];
    chronological.forEach((commit) => planLines.push(`  ${formatCommitLine(commit)}`));
    ctx.interaction.notify({ level: "info", message: planLines.join("\n") });
    return { repositoryPath: cwd, status: "DRY-RUN", releaseBranch: releaseBranchName };
  }

  ctx.interaction.notify({ level: "step", message: "Create release branch", current: 4, total: totalSteps });
  const { branch: releaseBranch } = await prepareTargetAndReleaseBranch({
    cwd,
    targetBranch: input.targetBranch,
    releaseBranchName,
    onExisting: async (branch) => {
      const choice = await ctx.interaction.select({
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
        try {
          const name = await ctx.interaction.input({
            message: "New release branch name",
            validate: (value) => (value.trim() ? true : "Value is required"),
          });
          return { rename: name };
        } catch {
          return "abort"; // cancelled — original behavior aborts rather than proceeding without a name
        }
      }

      return choice as "reuse" | "recreate" | "abort";
    },
  });

  ctx.interaction.notify({ level: "step", message: "Cherry-pick", current: 5, total: totalSteps });
  const pickResult = await executeCherryPicks(cwd, chronological, ctx);

  if (pickResult.aborted) {
    return { repositoryPath: cwd, status: "CONFLICT", releaseBranch, message: "Cherry-pick aborted." };
  }

  ctx.interaction.notify({ level: "step", message: "Build", current: 6, total: totalSteps });
  const buildCommand = await resolveBuildCommand(cwd, input, ctx);
  let buildPassed = true;

  if (buildCommand) {
    await rememberGitBuildCommand(cwd, buildCommand);
    ctx.interaction.notify({ level: "step", message: "Trace dependencies", current: 7, total: totalSteps });
    buildPassed = await runBuildAndTraceDependencies(cwd, range, scopeLabel, buildCommand, ctx);
  } else {
    ctx.interaction.notify({ level: "muted", message: "Build skipped." });
  }

  ctx.interaction.notify({ level: "step", message: "Summary", current: 8, total: totalSteps });
  await showSummaryAndPush(cwd, input.targetBranch, releaseBranch, ctx);

  return {
    repositoryPath: cwd,
    status: buildPassed ? "PASS" : "CONFLICT",
    releaseBranch,
    message: buildPassed ? undefined : "Build did not pass.",
  };
}

export async function runMoveCodeWorkflow(input: TGitMoveCodeInput, repositoryPaths: string[] | undefined, ctx: TWorkflowContext): Promise<TGitMoveCodeRepoResult[]> {
  const paths = repositoryPaths && repositoryPaths.length ? repositoryPaths : [input.cwd ?? process.cwd()];
  const results: TGitMoveCodeRepoResult[] = [];

  for (const repoPath of paths) {
    if (paths.length > 1) {
      ctx.interaction.notify({ level: "info", message: chalk.bold.underline(`Repository: ${repoPath}`) });
    }

    try {
      const result = await runMoveCodeForRepository(repoPath, input, ctx);
      results.push(result);
    } catch (error) {
      results.push({ repositoryPath: repoPath, status: "ABORTED", message: error instanceof Error ? error.message : String(error) });
      ctx.interaction.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });

      if (isWholeWorkflowCancelled(ctx)) {
        throw error;
      }
    }
  }

  if (paths.length > 1) {
    const nameWidth = Math.max(4, ...results.map((result) => result.repositoryPath.length));
    ctx.interaction.notify({
      level: "info",
      message: [chalk.bold("Multi-repository summary:"), ...results.map((result) => `${result.repositoryPath.padEnd(nameWidth)}  ${result.status}`)].join("\n"),
    });
  }

  return results;
}
