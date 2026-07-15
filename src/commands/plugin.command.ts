import chalk from "chalk";
import { Command } from "commander";
import prompts from "prompts";
import { searchableSelectChoice } from "../core/prompts";
import { resolveRepositoryPath } from "../core/repository";
import { runPluginDoctor } from "../core/plugins/plugin-doctor";
import { PluginCycleError, PluginNotFoundError } from "../core/plugins/plugin-graph";
import { buildInstallPlan, executeInstallPlan, uninstallPlugin, updateInstalledPlugin } from "../core/plugins/plugin-installer";
import { getPluginUsage, loadPluginRegistry } from "../core/plugins/plugin-registry";
import { readAllInstalled } from "../core/plugins/plugin-state-store";
import type { TInstallPlan, TInstallScope, TPluginManifest } from "../core/plugins/plugin-types";

type TScopeOption = { scope?: string; cwd?: string };

async function resolveProjectRoot(cwd?: string): Promise<string> {
  return resolveRepositoryPath(cwd ?? process.cwd());
}

async function askScope(provided?: string): Promise<TInstallScope> {
  if (provided === "user" || provided === "project") return provided;
  const choice = await searchableSelectChoice({
    message: "Install scope",
    choices: [
      { title: "User (available in every project on this machine)", value: "user" },
      { title: "Project (this repo only, under ./.claude — shareable via git)", value: "project" },
    ],
    allowCustomValue: false,
  });
  return choice as TInstallScope;
}

async function askPluginId(registry: Map<string, TPluginManifest>): Promise<string> {
  return searchableSelectChoice({
    message: "Plugin to install",
    choices: [...registry.values()].map((manifest) => ({
      title: `${manifest.displayName} (${manifest.id})`,
      value: manifest.id,
      description: manifest.description,
    })),
    allowCustomValue: false,
  });
}

async function confirm(message: string, initial = true): Promise<boolean> {
  const response = await prompts({ type: "confirm", name: "value", message, initial });
  return Boolean(response.value);
}

function formatManifestLine(manifest: TPluginManifest, installedNote?: string): string {
  const kindLabel = chalk.gray(`[${manifest.kind}]`);
  const suffix = installedNote ? chalk.green(` (${installedNote})`) : "";
  return `${chalk.bold(manifest.id)} ${kindLabel} — ${manifest.displayName}${suffix}`;
}

async function runListCommand(options: TScopeOption): Promise<void> {
  const registry = await loadPluginRegistry();
  const projectRoot = await resolveProjectRoot(options.cwd).catch(() => undefined);
  const installed = await readAllInstalled(projectRoot);
  const installedById = new Map(installed.map((record) => [record.pluginId, record]));

  if (registry.size === 0) {
    console.log("No plugins found in the bundled registry.");
    return;
  }

  console.log("");
  console.log(chalk.bold("Available plugins"));
  console.log("");

  for (const manifest of registry.values()) {
    const record = installedById.get(manifest.id);
    console.log(formatManifestLine(manifest, record ? `installed, ${record.scope}` : undefined));
    if (manifest.dependsOn.length > 0) {
      console.log(chalk.gray(`  depends on: ${manifest.dependsOn.join(", ")}`));
    }
  }

  console.log("");
  console.log(chalk.gray('Run "smdg plugin info <id>" for details, or "smdg plugin add <id>" to install.'));
}

async function runInfoCommand(pluginId: string): Promise<void> {
  const registry = await loadPluginRegistry();
  const manifest = registry.get(pluginId);
  if (!manifest) {
    console.error(chalk.red(`Plugin not found: ${pluginId}`));
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(chalk.bold(`${manifest.displayName} (${manifest.id})`));
  console.log(chalk.gray(`v${manifest.version} — ${manifest.kind}`));
  console.log("");
  console.log(manifest.description);
  console.log("");
  console.log(`Depends on: ${manifest.dependsOn.length ? manifest.dependsOn.join(", ") : "(none)"}`);
  if (manifest.components.agentFiles?.length) console.log(`Agents: ${manifest.components.agentFiles.length}`);
  if (manifest.components.skillDir) console.log(`Skill: ${manifest.id}`);
  if (manifest.components.mcpServers?.length) {
    console.log(`MCP servers: ${manifest.components.mcpServers.map((server) => server.name).join(", ")}`);
  }
  if (manifest.studioExtension) {
    console.log(`AI Studio panel: ${manifest.studioExtension.label}`);
  }

  const usage = await getPluginUsage(pluginId);
  if (usage) {
    console.log("");
    console.log(chalk.bold("Usage:"));
    console.log(usage.trim());
  }
  console.log("");
}

function printPlan(plan: TInstallPlan): void {
  console.log("");
  console.log(chalk.bold("Install plan"));
  console.log("");

  for (const step of plan.steps) {
    if (step.alreadySatisfied) {
      console.log(`${chalk.gray("=")} ${step.pluginId} — already installed (${step.satisfiedAtScope} scope), skipping`);
      continue;
    }

    console.log(`${chalk.green("+")} ${step.pluginId} (${step.manifest.version})`);
    for (const file of step.filesToWrite) {
      const tag = file.driftDetected ? chalk.red("[hand-modified, needs --force]") : file.isNew ? chalk.gray("[new]") : chalk.yellow("[overwrite]");
      console.log(`    file  ${file.targetPath} ${tag}`);
    }
    for (const server of step.mcpServersToRegister) {
      console.log(`    mcp   ${server.name} (-s ${server.scope})`);
    }
  }
  console.log("");
}

async function runAddCommand(ids: string[], options: { scope?: string; cwd?: string; dryRun?: boolean; yes?: boolean; force?: boolean }): Promise<void> {
  const registry = await loadPluginRegistry();
  const requestedIds = ids.length > 0 ? ids : [await askPluginId(registry)];
  const scope = await askScope(options.scope);
  const projectRoot = scope === "project" ? await resolveProjectRoot(options.cwd) : options.cwd ? await resolveProjectRoot(options.cwd).catch(() => undefined) : undefined;

  let plan: TInstallPlan;
  try {
    plan = await buildInstallPlan(requestedIds, scope, projectRoot);
  } catch (error) {
    if (error instanceof PluginCycleError) {
      console.error(chalk.red(`Cannot install: ${error.message}`));
    } else if (error instanceof PluginNotFoundError) {
      console.error(chalk.red(`Unknown plugin id: ${error.pluginId}`));
    } else {
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    }
    process.exitCode = 1;
    return;
  }

  printPlan(plan);

  const pendingSteps = plan.steps.filter((step) => !step.alreadySatisfied);
  if (pendingSteps.length === 0) {
    console.log(chalk.gray("Nothing to do — everything requested is already installed."));
    return;
  }

  const driftedFiles = pendingSteps.flatMap((step) => step.filesToWrite.filter((file) => file.driftDetected));
  if (driftedFiles.length > 0 && !options.force) {
    console.error(chalk.red(`${driftedFiles.length} target file(s) already exist with unrecognized content. Re-run with --force to overwrite, or resolve them first.`));
    process.exitCode = 1;
    return;
  }

  if (options.dryRun) {
    console.log(chalk.gray("Dry run — no changes made."));
    return;
  }

  if (!options.yes && !(await confirm(`Proceed with installing ${pendingSteps.length} plugin(s) at ${scope} scope?`))) {
    console.log("Cancelled.");
    return;
  }

  try {
    await executeInstallPlan(plan, scope, projectRoot, { force: options.force });
  } catch (error) {
    console.error(chalk.red(`Install failed, rolled back: ${error instanceof Error ? error.message : String(error)}`));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.green(`Installed ${pendingSteps.length} plugin(s).`));

  for (const step of pendingSteps) {
    const usage = await getPluginUsage(step.pluginId);
    if (!usage) continue;
    console.log("");
    console.log(chalk.bold(`── ${step.pluginId} usage ──`));
    console.log(usage.trim());
  }
  console.log("");
}

async function runRemoveCommand(pluginId: string, options: { cwd?: string; forceCascade?: boolean; yes?: boolean }): Promise<void> {
  const projectRoot = await resolveProjectRoot(options.cwd).catch(() => undefined);

  const firstAttempt = await uninstallPlugin(pluginId, { projectRoot }).catch((error: unknown) => {
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
    return undefined;
  });
  if (!firstAttempt) return;

  if ("blockedBy" in firstAttempt) {
    console.error(chalk.red(`Cannot remove "${pluginId}" — other installed plugins still depend on it: ${firstAttempt.blockedBy.join(", ")}`));
    console.error(chalk.gray("Remove those first, or re-run with --force-cascade to remove them all together."));

    if (!options.forceCascade) {
      process.exitCode = 1;
      return;
    }

    if (!options.yes && !(await confirm(`Also remove ${firstAttempt.blockedBy.join(", ")} along with ${pluginId}?`, false))) {
      console.log("Cancelled.");
      return;
    }

    const cascadeResult = await uninstallPlugin(pluginId, { projectRoot, forceCascade: true });
    if ("blockedBy" in cascadeResult) {
      console.error(chalk.red("Unexpected: still blocked after cascade."));
      process.exitCode = 1;
      return;
    }
    console.log(chalk.green(`Removed: ${cascadeResult.removedPluginIds.join(", ")}`));
    return;
  }

  console.log(chalk.green(`Removed: ${firstAttempt.removedPluginIds.join(", ")}`));
}

async function runUpdateCommand(pluginId: string | undefined, options: { cwd?: string; force?: boolean }): Promise<void> {
  const projectRoot = await resolveProjectRoot(options.cwd).catch(() => undefined);
  const installed = await readAllInstalled(projectRoot);
  const targetIds = pluginId ? [pluginId] : installed.map((record) => record.pluginId);

  if (targetIds.length === 0) {
    console.log("Nothing installed to update.");
    return;
  }

  for (const id of targetIds) {
    try {
      const result = await updateInstalledPlugin(id, { force: options.force, projectRoot });
      const versionNote = result.fromVersion === result.toVersion ? `v${result.toVersion} (reinstalled)` : `${result.fromVersion} -> ${result.toVersion}`;
      console.log(chalk.green(`Updated ${result.pluginId} ${versionNote}`));
    } catch (error) {
      console.error(chalk.red(`${id}: ${error instanceof Error ? error.message : String(error)}`));
      process.exitCode = 1;
    }
  }
}

async function runDoctorCommand(options: { cwd?: string }): Promise<void> {
  const projectRoot = await resolveProjectRoot(options.cwd).catch(() => undefined);
  const report = await runPluginDoctor(projectRoot);

  console.log("");
  console.log(chalk.bold("Plugin doctor"));
  console.log("");
  console.log(`Installed: ${report.installedCount}`);

  if (report.issues.length === 0) {
    console.log(chalk.green("No issues found."));
    console.log("");
    return;
  }

  console.log("");
  for (const issue of report.issues) {
    console.log(`${chalk.yellow("!")} [${issue.scope}] ${issue.pluginId} — ${issue.kind}: ${issue.detail}`);
  }
  console.log("");
}

export function registerPluginCommands(program: Command): void {
  const pluginCommand = program.command("plugin").description("Browse and manage installable Claude Code plugins (agents, skills, MCP bundles)");

  pluginCommand
    .command("list")
    .description("List available plugins and their install status")
    .option("--scope <scope>", "user|project — only affects install-status lookup for the current project")
    .option("--cwd <path>", "Project path for project-scope install-status lookup", process.cwd())
    .action(runListCommand);

  pluginCommand
    .command("info <id>")
    .description("Show details and usage instructions for a plugin")
    .action(runInfoCommand);

  pluginCommand
    .command("add [ids...]")
    .description("Install one or more plugins (prompts interactively if omitted)")
    .option("--scope <scope>", "user|project")
    .option("--cwd <path>", "Project path (required for --scope project)", process.cwd())
    .option("--dry-run", "Preview the install plan without making changes")
    .option("--yes", "Skip the confirmation prompt")
    .option("--force", "Overwrite hand-modified files")
    .action(runAddCommand);

  pluginCommand
    .command("remove <id>")
    .description("Uninstall a plugin (refuses if other installed plugins still depend on it)")
    .option("--cwd <path>", "Project path", process.cwd())
    .option("--force-cascade", "Also remove any installed plugins that depend on this one")
    .option("--yes", "Skip the confirmation prompt")
    .action(runRemoveCommand);

  pluginCommand
    .command("update [id]")
    .description("Re-sync installed plugin(s) with the currently bundled registry (all installed if omitted)")
    .option("--cwd <path>", "Project path", process.cwd())
    .option("--force", "Overwrite hand-modified files")
    .action(runUpdateCommand);

  pluginCommand
    .command("doctor")
    .description("Report drift, missing files, and missing MCP registrations for installed plugins")
    .option("--cwd <path>", "Project path", process.cwd())
    .action(runDoctorCommand);

  pluginCommand.action(runListCommand);
}
