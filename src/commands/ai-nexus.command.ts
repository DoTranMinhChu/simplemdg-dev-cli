import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { searchableSelectChoice, searchableSelectOrInput } from "../core/prompts";
import { resolveChangeScopeFiles, type TGitChangeScope } from "../core/git/git-diff-service";
import { getGitRepoRoot, isInsideGitRepository } from "../core/git/git-repository";
import { analyzeChangeImpact, analyzeSymbolChangeImpact } from "../core/nexus/nexus-change-impact-service";
import { getGitNexusVersion } from "../core/nexus/gitnexus-runtime";
import { ensureGitNexusServeRunning } from "../core/nexus/gitnexus-serve-launcher";
import { configureCodingAgent, removeCodingAgentConfig, type TNexusCodingAgent } from "../core/nexus/nexus-mcp-configurator";
import { getProjectOverview } from "../core/nexus/nexus-overview-service";
import { getSymbolContext, getSymbolImpact, searchFeature } from "../core/nexus/nexus-query-service";
import { discoverGitRepositories } from "../core/nexus/nexus-repo-discovery";
import { analyzeRepo, getRepoFreshness, listAnalyzedRepos, normalizeRepoPath, removeAnalyzedRepo, sanitizeRepoAlias } from "../core/nexus/nexus-repo-service";
import { mapInstallStatus } from "../core/nexus/nexus-status";
import {
  addRepoToWorkspace,
  createWorkspace,
  getWorkspaceContracts,
  getWorkspaceImpact,
  getWorkspaceStatus,
  listWorkspaces,
  removeRepoFromWorkspace,
  searchWorkspace,
  syncWorkspace,
} from "../core/nexus/nexus-workspace-service";
import { openBrowser } from "../core/studio-shared/studio-server-kit";
import type { TNexusRepoSummary } from "../core/nexus/nexus-types";

function statusIcon(status: string): string {
  if (status === "ready") return chalk.green("✓");
  if (status === "analyzing") return chalk.cyan("…");
  if (status === "update-required") return chalk.yellow("⚠");
  if (status === "index-required") return chalk.gray("○");
  if (status === "setup-required") return chalk.gray("○");
  return chalk.red("✗");
}

async function requireGitNexusInstalled(): Promise<boolean> {
  const version = await getGitNexusVersion();
  const { status, message } = mapInstallStatus(version);
  if (status !== "ready") {
    console.log(chalk.yellow(message));
    console.log(chalk.gray('Run "smdg ai nexus setup" to get started.'));
    return false;
  }
  return true;
}

/** Resolves a repo path only — cwd-based auto-detect, an explicit `--repo`, or a prompt over already-analyzed repos. Used by `analyze`, which doesn't require the repo to be registered yet. */
async function resolveRepoPath(repoOption: string | undefined): Promise<string | undefined> {
  if (repoOption) return path.resolve(repoOption);

  if (await isInsideGitRepository(process.cwd())) {
    return getGitRepoRoot(process.cwd());
  }

  const listed = await listAnalyzedRepos();
  if (!listed.ok || listed.repos.length === 0) return undefined;
  if (listed.repos.length === 1) return listed.repos[0].path;

  const choice = await searchableSelectChoice({
    message: "Select a repository",
    choices: listed.repos.map((repo) => ({ title: `${repo.name}  (${repo.path})`, value: repo.path })),
    allowCustomValue: false,
  });
  return choice;
}

/** Resolves a repo that must already be analyzed — path plus its registered GitNexus alias (looked up from `gitnexus list`, since the alias used at analyze time can differ from a freshly-sanitized guess on collision). */
async function resolveAnalyzedRepo(repoOption: string | undefined): Promise<TNexusRepoSummary | undefined> {
  const listed = await listAnalyzedRepos();
  if (!listed.ok) {
    console.log(chalk.red(listed.message));
    return undefined;
  }

  if (repoOption) {
    const resolved = normalizeRepoPath(repoOption);
    const match = listed.repos.find((repo) => normalizeRepoPath(repo.path) === resolved || repo.name === repoOption);
    if (!match) {
      console.log(chalk.yellow(`"${repoOption}" hasn't been analyzed yet. Run "smdg ai nexus analyze ${repoOption}" first.`));
      return undefined;
    }
    return match;
  }

  if (await isInsideGitRepository(process.cwd())) {
    const root = await getGitRepoRoot(process.cwd());
    const normalizedRoot = normalizeRepoPath(root);
    const match = listed.repos.find((repo) => normalizeRepoPath(repo.path) === normalizedRoot);
    if (match) return match;
    console.log(chalk.yellow("This repository hasn't been analyzed yet. Run \"smdg ai nexus analyze\" first."));
    return undefined;
  }

  if (listed.repos.length === 0) {
    console.log(chalk.yellow("No repositories have been analyzed yet. Run \"smdg ai nexus analyze <path>\" first."));
    return undefined;
  }

  if (listed.repos.length === 1) return listed.repos[0];

  const choice = await searchableSelectChoice({
    message: "Select an analyzed repository",
    choices: listed.repos.map((repo) => ({ title: `${repo.name}  (${repo.path})`, value: repo.name })),
    allowCustomValue: false,
  });
  return listed.repos.find((repo) => repo.name === choice);
}

async function runSetupCommand(): Promise<void> {
  console.log("");
  console.log(chalk.bold("Code Intelligence setup"));
  console.log("");

  const version = await getGitNexusVersion();
  if (!version.installed) {
    console.log(chalk.yellow("GitNexus isn't installed yet."));
    console.log(chalk.gray("It will be downloaded automatically via npx the first time it's needed (no separate install step required)."));
    console.log(chalk.gray("If you're offline, connect to the internet and re-run this command."));
    const recheck = await getGitNexusVersion();
    if (!recheck.installed) {
      console.log(chalk.red(`Could not reach GitNexus: ${recheck.reason === "network" ? "no network access" : recheck.detail}`));
      return;
    }
  } else {
    console.log(chalk.green(`GitNexus ${version.version} is available.`));
  }

  const agentChoice = await searchableSelectChoice({
    message: "Configure an AI coding agent to use Code Intelligence now?",
    choices: [
      { title: "Claude Code", value: "claude" },
      { title: "Codex", value: "codex" },
      { title: "Skip for now", value: "skip" },
    ],
    allowCustomValue: false,
  });

  if (agentChoice !== "skip") {
    console.log(chalk.gray(`Configuring ${agentChoice}...`));
    const result = await configureCodingAgent(agentChoice as TNexusCodingAgent);
    if (result.ok) {
      console.log(chalk.green(`${agentChoice} is now configured to use GitNexus.`));
    } else {
      console.log(chalk.red(`Could not configure ${agentChoice}: ${result.message}`));
    }
  }

  if (await isInsideGitRepository(process.cwd())) {
    const analyzeNow = await searchableSelectChoice({
      message: "Analyze the current repository now?",
      choices: [
        { title: "Yes, analyze it", value: "yes" },
        { title: "Not now", value: "no" },
      ],
      allowCustomValue: false,
    });
    if (analyzeNow === "yes") {
      await runAnalyzeCommand(undefined, {});
    }
  }

  console.log("");
  console.log(chalk.gray('Run "smdg ai nexus status" any time to check readiness.'));
}

async function runStatusCommand(options: { repo?: string }): Promise<void> {
  const version = await getGitNexusVersion();
  const install = mapInstallStatus(version);
  console.log("");
  console.log(`${statusIcon(install.status)} ${install.message}`);

  if (install.status !== "ready") {
    console.log("");
    return;
  }

  const listed = await listAnalyzedRepos();
  if (!listed.ok) {
    console.log(chalk.red(listed.message));
    return;
  }

  if (listed.repos.length === 0) {
    console.log(chalk.gray("No repositories analyzed yet."));
    console.log("");
    return;
  }

  console.log("");
  console.log(chalk.bold("Analyzed repositories:"));
  for (const repo of listed.repos) {
    console.log(`  ${statusIcon(repo.status)} ${repo.name.padEnd(28)} ${chalk.gray(repo.path)}`);
    console.log(`    ${chalk.gray(repo.message)}`);
  }
  console.log("");
}

async function runAnalyzeCommand(pathArg: string | undefined, options: { force?: boolean; fullContext?: boolean; name?: string }): Promise<void> {
  if (!(await requireGitNexusInstalled())) return;

  const repoPath = await resolveRepoPath(pathArg);
  if (!repoPath) {
    console.log(chalk.red("Not inside a git repository, and no path given. Pass a path: smdg ai nexus analyze <path>"));
    process.exitCode = 1;
    return;
  }

  const alias = options.name ?? sanitizeRepoAlias(repoPath);
  console.log(chalk.gray(`Analyzing ${repoPath} ...`));
  if (!options.fullContext) {
    console.log(chalk.gray("(index-only — won't modify AGENTS.md/CLAUDE.md or install skill files; use --full-context to also let GitNexus add those)"));
  }

  const result = await analyzeRepo(repoPath, { name: alias, force: options.force, fullContext: options.fullContext });
  if (!result.ok) {
    console.log(chalk.red(`Analysis failed: ${result.message}`));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.green("Repository analyzed."));
  console.log(result.stdout.trim());
}

async function runDiscoverCommand(folderArg: string | undefined): Promise<void> {
  const folder = path.resolve(folderArg ?? process.cwd());
  console.log(chalk.gray(`Searching for git repositories under ${folder} ...`));
  const discovered = await discoverGitRepositories(folder);

  if (discovered.length === 0) {
    console.log(chalk.yellow("No git repositories found."));
    return;
  }

  console.log(chalk.bold(`Found ${discovered.length} repositories.`));

  const selected = await searchableSelectOrInput({
    message: "Type to filter, then pick a repository to analyze (or Ctrl+C to just list them)",
    values: discovered.map((repo) => repo.path),
  }).catch(() => undefined);

  if (!selected) {
    for (const repo of discovered) console.log(`  ${repo.name}  ${chalk.gray(repo.path)}`);
    return;
  }

  await runAnalyzeCommand(selected, {});
}

async function runRemoveCommand(target: string | undefined): Promise<void> {
  if (!target) {
    const repo = await resolveAnalyzedRepo(undefined);
    if (!repo) return;
    target = repo.name;
  }

  const result = await removeAnalyzedRepo(target);
  if (!result.ok) {
    console.log(chalk.red(result.message));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`Removed the Code Intelligence index for "${target}". Source files are untouched.`));
}

function parseChangeScope(options: { staged?: boolean; commit?: string; branch?: string }): TGitChangeScope {
  if (options.commit) return { kind: "commit", hash: options.commit };
  if (options.branch) {
    const [source, target] = options.branch.split(":");
    return { kind: "branch-diff", source: source ?? "HEAD", target: target ?? source ?? "main" };
  }
  if (options.staged) return { kind: "staged" };
  return { kind: "uncommitted" };
}

async function runChangesCommand(options: { repo?: string; staged?: boolean; commit?: string; branch?: string }): Promise<void> {
  const repo = await resolveAnalyzedRepo(options.repo);
  if (!repo) return;

  const scope = parseChangeScope(options);
  const outcome = await analyzeChangeImpact(repo.path, repo.name, scope);

  if (!outcome.ok) {
    console.log(chalk.red(outcome.message));
    process.exitCode = 1;
    return;
  }

  const result = outcome.result;
  console.log("");
  console.log(chalk.bold(`Change Impact: ${result.scopeDescription}`));
  console.log("");

  if (!result.changed) {
    console.log(chalk.gray("No changes in this scope."));
    return;
  }

  const riskColor = result.risk === "high" ? chalk.red : result.risk === "medium" ? chalk.yellow : result.risk === "low" ? chalk.green : chalk.gray;
  console.log(`Risk: ${riskColor(result.risk.toUpperCase())} — ${result.riskReason}`);
  if (result.caveat) console.log(chalk.gray(`Note: ${result.caveat}`));
  console.log("");

  if (result.changedSymbols.length) {
    console.log(chalk.bold("Changed symbols:"));
    for (const symbol of result.changedSymbols) console.log(`  - ${symbol.name}`);
  }

  const affectedFiles = await resolveChangeScopeFiles(repo.path, scope).catch(() => []);
  if (affectedFiles.length) {
    console.log("");
    console.log(chalk.bold("Changed files:"));
    for (const file of affectedFiles) console.log(`  ${file.status.padEnd(3)} ${file.path}`);
  }
  console.log("");
}

async function runImpactCommand(target: string | undefined, options: { repo?: string }): Promise<void> {
  const repo = await resolveAnalyzedRepo(options.repo);
  if (!repo) return;

  const symbolName = target ?? (await searchableSelectOrInput({ message: "Function or class name", values: [] }));
  const outcome = symbolName.includes("/") || symbolName.endsWith(".ts")
    ? { ok: false as const, message: "Impact analysis needs a function/class name, not a file path — use \"smdg ai nexus changes\" for whole-file change impact." }
    : await analyzeSymbolChangeImpact(repo.name, symbolName, repo.path);

  if (!outcome.ok) {
    console.log(chalk.red(outcome.message));
    process.exitCode = 1;
    return;
  }

  const result = outcome.result;
  const riskColor = result.risk === "high" ? chalk.red : result.risk === "medium" ? chalk.yellow : result.risk === "low" ? chalk.green : chalk.gray;
  console.log("");
  console.log(`Risk: ${riskColor(result.risk.toUpperCase())} — ${result.riskReason}`);
  console.log("");
}

async function runSearchCommand(query: string | undefined, options: { repo?: string }): Promise<void> {
  const repo = await resolveAnalyzedRepo(options.repo);
  if (!repo) return;

  const searchTerm = query ?? (await searchableSelectOrInput({ message: "What are you looking for?", values: [] }));
  const outcome = await searchFeature(searchTerm, { repo: repo.name });

  if (!outcome.ok) {
    console.log(chalk.red(outcome.message));
    process.exitCode = 1;
    return;
  }

  if (outcome.result.warning) {
    console.log(chalk.yellow(outcome.result.warning));
  }

  if (!outcome.result.matches.length) {
    console.log(chalk.yellow("No matching files found."));
    return;
  }

  console.log("");
  for (const match of outcome.result.matches) {
    console.log(`  ${match.rank}. ${match.filePath}  ${chalk.gray(`score ${match.score.toFixed(1)}`)}`);
  }
  console.log("");
}

async function runTraceCommand(symbol: string | undefined, options: { repo?: string }): Promise<void> {
  const repo = await resolveAnalyzedRepo(options.repo);
  if (!repo) return;

  const symbolName = symbol ?? (await searchableSelectOrInput({ message: "Function or class name", values: [] }));
  const outcome = await getSymbolContext(symbolName, { repo: repo.name, cwd: repo.path });

  if (!outcome.ok) {
    console.log(chalk.red(outcome.message));
    process.exitCode = 1;
    return;
  }

  if (!outcome.result.found || !outcome.result.symbol) {
    console.log(chalk.yellow(`"${symbolName}" wasn't found in the analyzed code.`));
    return;
  }

  const { symbol: found, callers, callees } = outcome.result;
  console.log("");
  console.log(chalk.bold(`${found.name}  ${chalk.gray(found.filePath)}`));
  console.log("");
  console.log(chalk.bold(`Used by ${callers.length} caller${callers.length === 1 ? "" : "s"}:`));
  for (const caller of callers) console.log(`  - ${caller.name}  ${chalk.gray(caller.filePath)}`);
  console.log("");
  console.log(chalk.bold(`Calls ${callees.length} function${callees.length === 1 ? "" : "s"}:`));
  for (const callee of callees) console.log(`  - ${callee.name}  ${chalk.gray(callee.filePath)}`);
  console.log("");
}

async function runConfigureCommand(options: { agent?: string; remove?: boolean }): Promise<void> {
  const agent = (options.agent as TNexusCodingAgent | undefined) ?? (await searchableSelectChoice({
    message: "Which coding agent?",
    choices: [
      { title: "Claude Code", value: "claude" },
      { title: "Codex", value: "codex" },
      { title: "Cursor", value: "cursor" },
      { title: "OpenCode", value: "opencode" },
      { title: "Antigravity", value: "antigravity" },
    ],
    allowCustomValue: false,
  })) as TNexusCodingAgent;

  const result = options.remove ? await removeCodingAgentConfig(agent) : await configureCodingAgent(agent);
  if (!result.ok) {
    console.log(chalk.red(result.message));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(options.remove ? `Removed GitNexus configuration for ${agent}.` : `${agent} is now configured to use GitNexus.`));
}

async function runWorkspaceCommand(action: string | undefined, args: string[]): Promise<void> {
  if (!action || action === "list") {
    const result = await listWorkspaces();
    if (!result.ok) {
      console.log(chalk.red(result.message));
      return;
    }
    if (!result.names.length) {
      console.log(chalk.gray('No workspaces yet. Create one with "smdg ai nexus workspace create <name>".'));
      return;
    }
    for (const name of result.names) console.log(`  ${name}`);
    return;
  }

  if (action === "create") {
    const name = args[0] ?? (await searchableSelectOrInput({ message: "Workspace name", values: [] }));
    const result = await createWorkspace(name);
    console.log(result.ok ? chalk.green(result.stdout.trim() || `Created workspace "${name}".`) : chalk.red(result.message));
    return;
  }

  if (action === "add") {
    const [workspace, groupPath, registryName] = args;
    if (!workspace || !groupPath || !registryName) {
      console.log(chalk.red("Usage: smdg ai nexus workspace add <workspace> <groupPath> <registryName>"));
      return;
    }
    const result = await addRepoToWorkspace(workspace, groupPath, registryName);
    console.log(result.ok ? chalk.green(result.stdout.trim()) : chalk.red(result.message));
    return;
  }

  if (action === "remove") {
    const [workspace, groupPath] = args;
    if (!workspace || !groupPath) {
      console.log(chalk.red("Usage: smdg ai nexus workspace remove <workspace> <groupPath>"));
      return;
    }
    const result = await removeRepoFromWorkspace(workspace, groupPath);
    console.log(result.ok ? chalk.green(result.stdout.trim()) : chalk.red(result.message));
    return;
  }

  if (action === "sync") {
    const name = args[0];
    if (!name) {
      console.log(chalk.red("Usage: smdg ai nexus workspace sync <workspace>"));
      return;
    }
    const result = await syncWorkspace(name);
    console.log(result.ok ? chalk.green(result.stdout.trim() || "Synced.") : chalk.red(result.message));
    return;
  }

  if (action === "status") {
    const name = args[0];
    if (!name) {
      console.log(chalk.red("Usage: smdg ai nexus workspace status <workspace>"));
      return;
    }
    const result = await getWorkspaceStatus(name);
    if (!result.ok) {
      console.log(chalk.red(result.message));
      return;
    }
    console.log(`${result.status.name} — ${result.status.synced ? "synced" : "never synced"}`);
    for (const member of result.status.members) {
      console.log(`  ${member.groupPath.padEnd(24)} index: ${member.indexStatus.padEnd(10)} contracts: ${member.contractsStatus}`);
    }
    return;
  }

  if (action === "contracts") {
    const name = args[0];
    if (!name) {
      console.log(chalk.red("Usage: smdg ai nexus workspace contracts <workspace>"));
      return;
    }
    const result = await getWorkspaceContracts(name);
    if (!result.ok) {
      console.log(chalk.red(result.message));
      return;
    }
    if (!result.contracts.length) {
      console.log(chalk.gray("No shared contracts detected yet — run \"workspace sync\" first if you haven't."));
      return;
    }
    for (const contract of result.contracts) {
      console.log(`  [${contract.direction}] ${contract.key}  (${contract.repo})  ${contract.symbolName}`);
    }
    return;
  }

  if (action === "impact") {
    const [name, groupPath, target] = args;
    if (!name || !groupPath || !target) {
      console.log(chalk.red("Usage: smdg ai nexus workspace impact <workspace> <groupPath> <symbol>"));
      return;
    }
    const result = await getWorkspaceImpact(name, groupPath, target);
    if (!result.ok) {
      console.log(chalk.red(result.message));
      return;
    }
    const riskColor = result.result.risk === "high" ? chalk.red : result.result.risk === "medium" ? chalk.yellow : result.result.risk === "low" ? chalk.green : chalk.gray;
    console.log(`Risk: ${riskColor(result.result.risk.toUpperCase())}`);
    console.log(`Direct callers: ${result.result.directCount}, business flows affected: ${result.result.processesAffected}, cross-repo hits: ${result.result.crossRepoHits}`);
    return;
  }

  if (action === "query" || action === "search") {
    const [name, ...queryParts] = args;
    const query = queryParts.join(" ");
    if (!name || !query) {
      console.log(chalk.red("Usage: smdg ai nexus workspace query <workspace> <search terms>"));
      return;
    }
    const result = await searchWorkspace(name, query);
    if (!result.ok) {
      console.log(chalk.red(result.message));
      return;
    }
    for (const entry of result.result.perRepo) console.log(`  ${entry.repo.padEnd(20)} ${entry.count} match(es)`);
    return;
  }

  console.log(chalk.red(`Unknown workspace action "${action}". Use list|create|add|remove|sync|status|contracts|impact|query.`));
}

async function runGraphCommand(): Promise<void> {
  if (!(await requireGitNexusInstalled())) return;

  console.log(chalk.gray("Starting GitNexus's local graph explorer..."));
  const result = await ensureGitNexusServeRunning();
  if (!result.ok) {
    console.log(chalk.red(result.message));
    process.exitCode = 1;
    return;
  }
  console.log(chalk.green(`${result.alreadyRunning ? "Already running" : "Started"}: ${result.url}`));
  await openBrowser(result.url);
}

async function runDoctorCommand(): Promise<void> {
  console.log("");
  console.log(chalk.bold("Code Intelligence doctor"));
  console.log("");

  const version = await getGitNexusVersion();
  const install = mapInstallStatus(version);
  console.log(`${statusIcon(install.status)} ${install.message}`);

  if (install.status !== "ready") {
    console.log("");
    return;
  }

  if (await isInsideGitRepository(process.cwd())) {
    const root = await getGitRepoRoot(process.cwd());
    const freshness = await getRepoFreshness(root);
    console.log("");
    console.log(chalk.bold("Current repository:"));
    if (freshness.ok) {
      console.log(`  Branch:          ${freshness.info.branch ?? "unknown"}`);
      console.log(`  Indexed commit:  ${freshness.info.indexedCommit ?? "n/a"}`);
      console.log(`  Up to date:      ${freshness.info.upToDate === undefined ? "unknown" : freshness.info.upToDate ? "yes" : "no"}`);
    } else {
      console.log(chalk.gray(`  ${freshness.message}`));
    }
  }
  console.log("");
}

async function runOverviewCommand(options: { repo?: string }): Promise<void> {
  const repo = await resolveAnalyzedRepo(options.repo);
  if (!repo) return;

  const overview = getProjectOverview(repo);
  console.log("");
  console.log(chalk.bold(repo.name));
  console.log(chalk.gray(repo.path));
  console.log("");
  console.log(`Branch:           ${overview.branch ?? "unknown"}`);
  console.log(`Analyzed:         ${overview.indexedAt ?? "unknown"}${overview.upToDate === false ? chalk.yellow("  (out of date)") : ""}`);
  if (overview.stats) {
    console.log(`Files:            ${overview.stats.files}`);
    console.log(`Symbols:          ${overview.stats.symbols}`);
    console.log(`Relationships:    ${overview.stats.edges}`);
    console.log(`Clusters:         ${overview.stats.clusters}`);
    console.log(`Execution flows:  ${overview.stats.processes}`);
  }
  console.log("");
  console.log(chalk.gray('Use "smdg ai nexus search <term>" to explore specific features, entry points, or flows.'));
  console.log("");
}

export function registerAiNexusCommands(ai: Command): void {
  const nexus = ai.command("nexus").description("Code Intelligence — understand a project, trace execution flows, and see change impact (powered by GitNexus)");

  nexus.command("setup").description("Guided first-time setup: install check, agent configuration, analyze current repo").action(runSetupCommand);

  nexus.command("status").description("Check Code Intelligence readiness").option("--repo <path>", "Repository path").action(runStatusCommand);

  nexus
    .command("analyze [path]")
    .description("Analyze a repository to discover dependencies and execution flows")
    .option("--force", "Force full re-index even if up to date")
    .option("--full-context", "Also let GitNexus add its own AGENTS.md/CLAUDE.md notes and skill files (off by default)")
    .option("--name <alias>", "Registry alias for this repo")
    .action(runAnalyzeCommand);

  nexus.command("discover [folder]").description("Discover nested git repositories under a folder").action(runDiscoverCommand);

  nexus.command("remove [target]").description("Delete a repository's Code Intelligence index (source files are untouched)").action(runRemoveCommand);

  nexus
    .command("changes")
    .description("Change Impact Analysis over uncommitted changes, staged changes, a commit, or a branch diff")
    .option("--repo <path>", "Repository path")
    .option("--staged", "Analyze staged changes instead of uncommitted changes")
    .option("--commit <hash>", "Analyze one commit")
    .option("--branch <source:target>", "Compare two branches, e.g. feature-x:main")
    .action(runChangesCommand);

  nexus.command("impact [target]").description("Blast-radius analysis for a specific function or class").option("--repo <path>", "Repository path").action(runImpactCommand);

  nexus.command("search [query]").description("Search for a feature or business concept").option("--repo <path>", "Repository path").action(runSearchCommand);

  nexus.command("trace [symbol]").description("Trace callers/callees for a function or class").option("--repo <path>", "Repository path").action(runTraceCommand);

  nexus.command("overview").description("Project overview for an analyzed repository").option("--repo <path>", "Repository path").action(runOverviewCommand);

  nexus
    .command("configure")
    .description("Configure (or remove) an AI coding agent's GitNexus integration")
    .option("--agent <agent>", "claude|codex|cursor|opencode|antigravity")
    .option("--remove", "Remove instead of configure")
    .action(runConfigureCommand);

  nexus
    .command("workspace <action> [args...]")
    .description("Manage multi-repo workspaces: list|create|add|remove|sync|status|contracts|impact|query")
    .action(runWorkspaceCommand);

  nexus.command("graph").description("Open GitNexus's own full graph explorer (advanced) in your browser").action(runGraphCommand);

  nexus.command("doctor").description("Diagnose Code Intelligence problems").action(runDoctorCommand);
}
