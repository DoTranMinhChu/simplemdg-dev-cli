import chalk from "chalk";
import { Command } from "commander";
import { resolveRepositoryPath } from "../core/repository";
import { readCache, getRememberedGitBuildCommand } from "../core/cache";
import { ensureExternalTool } from "../core/tooling";
import { PlainCliInteractionService } from "../core/interaction/plain-cli-interaction-service";
import { runMoveCodeWorkflow, searchScopeInteractive, selectCommitsInteractive, executeCherryPicks, toChronologicalOrder, resolveConflictInteractive, runBuildAndTraceDependencies, showSummaryAndPush } from "../core/git/git-move-code-workflow";
import { fetchAllPruned, getCurrentBranch, getGitRepoRoot, isCherryPickInProgress } from "../core/git/git-repository";
import { cherryPickAbort, cherryPickContinue } from "../core/git/git-cherry-pick-service";
import { DEFAULT_BUILD_COMMANDS } from "../core/git/git-build-service";
import type { TGitMoveCodeInput, TWorkflowContext } from "../core/git/git-types";

type TGitMoveCodeOptions = {
  source?: string;
  target?: string;
  scope?: string;
  path?: string;
  symbol?: string;
  commit?: string;
  build?: string;
  dryRun?: boolean;
  cwd?: string;
  repos?: string[];
};

function validateRequired(value: string): true | string {
  return value.trim() ? true : "Value is required";
}

/**
 * Traditional (non-shell) dispatch context: today's exact `prompts`/`console.log`
 * behavior via PlainCliInteractionService, plus a real AbortController wired to
 * SIGINT so Ctrl+C actually kills an in-flight build/cherry-pick instead of
 * being ignored (a small, additive safety improvement — no SIGINT handling
 * exists anywhere in the traditional CLI today). Disposed after the command
 * finishes so repeated invocations in one process (e.g. from the interactive
 * shell's legacy-command dispatch) don't accumulate SIGINT listeners.
 */
function createPlainWorkflowContext(): { ctx: TWorkflowContext; dispose: () => void } {
  const controller = new AbortController();
  const onSigint = () => controller.abort();
  process.once("SIGINT", onSigint);

  return {
    ctx: { interaction: new PlainCliInteractionService(), signal: controller.signal },
    dispose: () => process.off("SIGINT", onSigint),
  };
}

async function withPlainWorkflowContext<T>(run: (ctx: TWorkflowContext) => Promise<T>): Promise<T> {
  const { ctx, dispose } = createPlainWorkflowContext();
  try {
    return await run(ctx);
  } finally {
    dispose();
  }
}

async function resolveBranchOption(kind: "source" | "target", provided: string | undefined, ctx: TWorkflowContext): Promise<string> {
  if (provided) return provided;

  const cache = await readCache();
  const history = kind === "source" ? cache.git.sourceBranches : cache.git.targetBranches;

  return ctx.interaction.select({
    message: kind === "source" ? "Source branch" : "Target branch",
    choices: history.map((branch) => ({ title: branch, value: branch })),
    validateCustomValue: validateRequired,
    customValueTitle: (value) => `Use typed branch: ${value}`,
  });
}

/** Shared with the interactive shell's GitMoveCodeScreen, which launches with no CLI flags at all. */
export async function buildMoveCodeInput(options: TGitMoveCodeOptions, ctx: TWorkflowContext): Promise<TGitMoveCodeInput> {
  const sourceBranch = await resolveBranchOption("source", options.source, ctx);
  const targetBranch = await resolveBranchOption("target", options.target, ctx);

  return {
    sourceBranch,
    targetBranch,
    scope: options.scope,
    path: options.path,
    symbol: options.symbol,
    commit: options.commit,
    buildCommand: options.build,
    dryRun: Boolean(options.dryRun),
    cwd: options.cwd,
  };
}

async function runMoveCodeCommand(options: TGitMoveCodeOptions): Promise<void> {
  await withPlainWorkflowContext(async (ctx) => {
    await ensureExternalTool("git");
    const input = await buildMoveCodeInput(options, ctx);
    const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
    const results = await runMoveCodeWorkflow(input, options.repos && options.repos.length ? options.repos : [repositoryPath], ctx);

    const failed = results.some((result) => result.status === "CONFLICT" || result.status === "ABORTED");
    if (failed) {
      process.exitCode = 1;
    }
  });
}

async function runPickCommand(options: TGitMoveCodeOptions): Promise<void> {
  await withPlainWorkflowContext(async (ctx) => {
    await ensureExternalTool("git");
    const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
    const cwd = await getGitRepoRoot(repositoryPath);
    const input = await buildMoveCodeInput(options, ctx);
    const range = { source: input.sourceBranch, target: input.targetBranch };

    console.log(chalk.gray("Fetching latest branches..."));
    await fetchAllPruned(cwd);

    const discovery = await searchScopeInteractive(cwd, range, input, ctx);

    if (!discovery.length) {
      console.log(chalk.yellow(`No candidate commits found for origin/${input.targetBranch}..origin/${input.sourceBranch}.`));
      return;
    }

    const selected = await selectCommitsInteractive(
      cwd,
      discovery,
      () => searchScopeInteractive(cwd, range, { ...input, scope: undefined, path: undefined, symbol: undefined, commit: undefined }, ctx),
      ctx,
    );

    if (!selected || !selected.length) {
      console.log(chalk.yellow("Aborted before selecting commits."));
      return;
    }

    const chronological = toChronologicalOrder(selected, discovery);
    const result = await executeCherryPicks(cwd, chronological, ctx);

    if (result.aborted) {
      process.exitCode = 1;
    }
  });
}

async function runTraceCommand(options: TGitMoveCodeOptions): Promise<void> {
  await withPlainWorkflowContext(async (ctx) => {
    await ensureExternalTool("git");
    const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
    const cwd = await getGitRepoRoot(repositoryPath);
    const input = await buildMoveCodeInput(options, ctx);
    const range = { source: input.sourceBranch, target: input.targetBranch };

    const buildCommand = options.build
      ?? (await getRememberedGitBuildCommand(cwd))
      ?? await ctx.interaction.select({
        message: "Build command",
        choices: DEFAULT_BUILD_COMMANDS.map((command) => ({ title: command, value: command })),
        validateCustomValue: validateRequired,
        customValueTitle: (value) => `Use custom command: ${value}`,
      });

    const passed = await runBuildAndTraceDependencies(cwd, range, options.scope || options.path || options.symbol || "code", buildCommand, ctx);

    if (!passed) {
      process.exitCode = 1;
    }
  });
}

async function runConflictCommand(options: TGitMoveCodeOptions): Promise<void> {
  await withPlainWorkflowContext(async (ctx) => {
    await ensureExternalTool("git");
    const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
    const cwd = await getGitRepoRoot(repositoryPath);

    if (!(await isCherryPickInProgress(cwd))) {
      console.log(chalk.gray("No cherry-pick is currently in progress in this repository."));
      return;
    }

    const decision = await resolveConflictInteractive(cwd, ctx);

    if (decision === "abort") {
      await cherryPickAbort(cwd);
      console.log(chalk.yellow("Cherry-pick aborted."));
      return;
    }

    const outcome = await cherryPickContinue(cwd);

    if (outcome.result === "success") {
      console.log(chalk.green("Cherry-pick continued successfully."));
    } else if (outcome.result === "conflict") {
      console.log(chalk.yellow("More conflicts remain. Run `smdg git conflict` again."));
    } else {
      console.log(chalk.red(outcome.stderr || outcome.stdout || "Cherry-pick could not continue."));
      process.exitCode = 1;
    }
  });
}

async function runSummaryCommand(options: TGitMoveCodeOptions): Promise<void> {
  await withPlainWorkflowContext(async (ctx) => {
    await ensureExternalTool("git");
    const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
    const cwd = await getGitRepoRoot(repositoryPath);
    const targetBranch = await resolveBranchOption("target", options.target, ctx);
    const currentBranch = await getCurrentBranch(cwd);

    await showSummaryAndPush(cwd, targetBranch, currentBranch, ctx);
  });
}

export function registerGitCommands(program: Command): void {
  const git = program
    .command("git")
    .description("Move scoped code safely between branches across microservice repositories (release dependency tracing assistant)");

  const withMoveCodeOptions = (command: Command): Command => command
    .option("--source <branch>", "Source branch to move code from (e.g. staging)")
    .option("--target <branch>", "Target branch to move code onto (e.g. uat, qas)")
    .option("--scope <ticketOrFeature>", "Scope to search for: Jira ticket, feature name, or keyword")
    .option("--path <path>", "Search by file or folder path instead of keyword")
    .option("--symbol <symbol>", "Search by class/function/type/API/entity name")
    .option("--commit <hash>", "Add a specific commit hash manually")
    .option("--build <command>", "Build/test command to run after cherry-picking")
    .option("--cwd <path>", "Repository path (defaults to the current directory)")
    .option("--repos <paths...>", "Run across multiple repositories (multi-repo mode)");

  withMoveCodeOptions(
    git
      .command("move-code")
      .description("Guided workflow: search, cherry-pick, resolve conflicts, build, trace dependencies, and push a release branch")
      .option("--dry-run", "Search and show the plan only — create nothing, cherry-pick nothing"),
  ).action(runMoveCodeCommand);

  withMoveCodeOptions(
    git
      .command("pick")
      .description("Search and cherry-pick commits only (assumes you already have a release branch checked out)"),
  ).action(runPickCommand);

  withMoveCodeOptions(
    git
      .command("trace")
      .description("Run the build command and trace missing dependencies from build errors"),
  ).action(runTraceCommand);

  git
    .command("conflict")
    .description("Guided resolution for the cherry-pick conflict currently in progress")
    .option("--cwd <path>", "Repository path (defaults to the current directory)")
    .action(runConflictCommand);

  git
    .command("summary")
    .description("Show the commit/diff summary versus a target branch, and optionally push")
    .option("--target <branch>", "Target branch to diff against (e.g. uat, qas)")
    .option("--cwd <path>", "Repository path (defaults to the current directory)")
    .action(runSummaryCommand);
}
