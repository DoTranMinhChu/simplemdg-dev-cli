import chalk from "chalk";
import { Command } from "commander";
import { startToolStudioServer } from "../core/tool/studio/tool-studio-server";
import { getDefaultGitLabAuth } from "../core/gitlab/gitlab-client";
import { importLegacyToolConfig } from "../core/deploy/legacy-config-importer";

type TToolStudioCommandOptions = { port?: string; devUi?: boolean; apiOnly?: boolean };
type TImportLegacyConfigOptions = { environment?: string; btpSpace?: string };

async function runImportLegacyConfigCommand(options: TImportLegacyConfigOptions): Promise<void> {
  if (!options.environment && !options.btpSpace) {
    console.error(chalk.red("Pass at least one of --environment <path> or --btp-space <path>."));
    process.exitCode = 1;
    return;
  }

  const auth = await getDefaultGitLabAuth();
  if (!auth) {
    console.error(chalk.red("Not logged in to GitLab. Run: smdg gitlab login"));
    process.exitCode = 1;
    return;
  }

  const result = await importLegacyToolConfig({ auth, environmentJsonPath: options.environment, btpSpaceJsonPath: options.btpSpace });

  console.log(chalk.green(`Imported ${result.importedTargets} deploy target(s) and ${result.importedCredentials} BTP service credential(s).`));
  if (result.warnings.length) {
    console.log("");
    console.log(chalk.yellow(`${result.warnings.length} item(s) need manual fixup:`));
    for (const warning of result.warnings) console.log(chalk.yellow(`  [${warning.source}] ${warning.key}: ${warning.message}`));
  }
}

async function runToolStudioCommand(options: TToolStudioCommandOptions): Promise<void> {
  const apiOnly = Boolean(options.apiOnly || options.devUi);
  const handle = await startToolStudioServer({ port: options.port ? Number(options.port) : undefined, apiOnly });

  if (options.devUi) {
    console.log(chalk.gray("Running in --dev-ui mode. In another terminal:"));
    console.log(chalk.cyan("  cd studio && npm run dev"));
    console.log(chalk.gray(`Then open the Vite dev URL; it proxies /api/tool to ${handle.url}.`));
  }

  const shutdown = async (): Promise<void> => {
    console.log("");
    console.log(chalk.gray("Stopping Tool Studio..."));
    await Promise.race([handle.close(), new Promise<void>((resolve) => setTimeout(resolve, 2000))]);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await new Promise(() => undefined); // Keep the process alive until shutdown() calls process.exit().
}

export function registerToolCommands(program: Command): void {
  const tool = program.command("tool").description("SimpleMDG Tool Studio: MDG deploy tooling, BTP/GitLab-backed helpers ported from the legacy GitLab API tool");

  tool
    .command("studio")
    .description("Open the local SimpleMDG Tool Studio (browser UI)")
    .option("--port <port>", "Preferred local port (auto-falls back if busy)")
    .option("--dev-ui", "Frontend development mode: API-only server + instructions to run the Vite dev server separately")
    .option("--api-only", "Start only the JSON/SSE API — no UI is served, no browser opens")
    .action(runToolStudioCommand);

  tool
    .command("import-legacy-config")
    .description("Best-effort seed Deploy Targets / BTP service credentials from the legacy tool's environment.json / btp-space.json")
    .option("--environment <path>", "Path to the legacy environment.json")
    .option("--btp-space <path>", "Path to the legacy btp-space.json")
    .action(runImportLegacyConfigCommand);
}
