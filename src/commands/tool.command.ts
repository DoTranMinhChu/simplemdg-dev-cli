import chalk from "chalk";
import { Command } from "commander";
import { startToolStudioServer } from "../core/tool/studio/tool-studio-server";
import { getDefaultGitLabAuth } from "../core/gitlab/gitlab-client";
import { importLegacyToolConfig } from "../core/deploy/legacy-config-importer";
import { getCfAuthStatus } from "../core/cf/cf-auth-service";
import { getResolvedBtpServiceCredential, listBtpServiceCredentials } from "../core/cf/btp-service-credential-store";
import { listDeployTargets } from "../core/deploy/deploy-target-store";

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

const CHECK = chalk.green("✓");
const CROSS = chalk.red("✗");
const WARN = chalk.yellow("⚠");

/** `expiresAt` is a future date for a still-valid token — formatRelativeTime (smart-cache.ts)
 * only handles past dates, so this is its own small helper rather than a misuse of that one. */
function formatTokenExpiry(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "no expiry recorded";
  const deltaMs = new Date(expiresAt).getTime() - Date.now();
  const days = Math.round(Math.abs(deltaMs) / (24 * 60 * 60 * 1000));
  if (deltaMs < 0) return chalk.red(`expired ${days} day${days === 1 ? "" : "s"} ago`);
  if (days <= 7) return chalk.yellow(`expires in ${days} day${days === 1 ? "" : "s"}`);
  return `expires in ${days} days`;
}

/**
 * One-shot readiness check for everything Tool Studio depends on (Cloud Foundry, GitLab, saved
 * BTP service credentials, deploy targets) — the terminal-side counterpart to the always-visible
 * connection status pills the Studio UI shows (ConnectionStatusRow.tsx), for anyone who wants the
 * full picture (including saved BTP credentials and deploy targets, which the UI pills don't cover)
 * without opening a browser, or wants it in a script/CI log.
 */
async function runToolDoctorCommand(): Promise<void> {
  const issues: string[] = [];

  console.log("");
  console.log(chalk.bold("Tool Studio doctor"));

  console.log("");
  console.log(chalk.bold("Cloud Foundry"));
  const cfStatus = await getCfAuthStatus();
  console.log(`  ${cfStatus.cfCliAvailable ? CHECK : CROSS} CLI installed`);
  if (!cfStatus.cfCliAvailable) {
    issues.push("Cloud Foundry CLI 'cf' is not installed or not on PATH. Install it, then run: smdg cf login");
  } else {
    console.log(`  ${cfStatus.isLoggedIn ? CHECK : CROSS} Logged in${cfStatus.cachedUsername ? ` as ${cfStatus.cachedUsername}` : ""}`);
    if (cfStatus.currentTarget?.org || cfStatus.currentTarget?.space) {
      console.log(chalk.gray(`      Target: ${[cfStatus.currentTarget.region, cfStatus.currentTarget.org, cfStatus.currentTarget.space].filter(Boolean).join(" / ")}`));
    }
    console.log(`  ${cfStatus.hasCachedCredentials ? CHECK : WARN} Cached password for automatic re-login${cfStatus.hasCachedCredentials ? "" : " — none saved"}`);
    if (!cfStatus.isLoggedIn) {
      issues.push("Not logged in to Cloud Foundry. Run: smdg cf login");
    } else if (!cfStatus.hasCachedCredentials) {
      issues.push("No saved CF password — an expired session won't auto-relogin. Run: smdg cf login and save the password when prompted.");
    }
  }

  console.log("");
  console.log(chalk.bold("GitLab"));
  const gitlabAuth = await getDefaultGitLabAuth();
  console.log(`  ${gitlabAuth ? CHECK : CROSS} Logged in${gitlabAuth?.username ? ` as ${gitlabAuth.username}` : ""}`);
  if (!gitlabAuth) {
    issues.push("Not logged in to GitLab. Run: smdg gitlab login");
  } else {
    console.log(chalk.gray(`      ${gitlabAuth.baseUrl} · token ${formatTokenExpiry(gitlabAuth.expiresAt)}`));
    if (gitlabAuth.expiresAt) {
      const deltaMs = new Date(gitlabAuth.expiresAt).getTime() - Date.now();
      if (deltaMs < 0) issues.push("GitLab token has expired. Run: smdg gitlab login");
      else if (deltaMs < 7 * 24 * 60 * 60 * 1000) issues.push("GitLab token expires within 7 days — re-run smdg gitlab login before it does.");
    }
  }

  console.log("");
  console.log(chalk.bold("BTP service credentials"));
  const credentials = await listBtpServiceCredentials();
  if (!credentials.length) {
    console.log(chalk.gray("  None saved yet — add one from Tool Studio's Check API External / BTP Credentials page."));
  } else {
    let staleCount = 0;
    for (const credential of credentials) {
      const canDecrypt = await getResolvedBtpServiceCredential(credential.id).then(
        () => true,
        () => false,
      );
      if (!canDecrypt) staleCount += 1;
      console.log(`  ${canDecrypt ? CHECK : CROSS} ${credential.name} — ${credential.serviceName} (${[credential.region, credential.org, credential.space].filter(Boolean).join("/")})`);
    }
    if (staleCount > 0) {
      issues.push(`${staleCount} BTP service credential${staleCount === 1 ? "" : "s"} can't be decrypted on this machine (created elsewhere) — remove and re-import ${staleCount === 1 ? "it" : "them"} from Check API External / BTP Credentials.`);
    }
  }

  console.log("");
  console.log(chalk.bold("Deploy targets"));
  const targets = await listDeployTargets();
  if (!targets.length) {
    console.log(chalk.gray("  None configured yet — add one from Deploy Model's \"Deploy target\" step."));
  } else {
    for (const target of targets) {
      console.log(`  ${CHECK} ${target.name} → ${target.gitlabGroupPath}`);
    }
  }

  console.log("");
  if (issues.length > 0) {
    console.log(chalk.bold.yellow(`${issues.length} thing${issues.length === 1 ? "" : "s"} need attention:`));
    for (const issue of issues) console.log(chalk.yellow(`  - ${issue}`));
    process.exitCode = 1;
  } else {
    console.log(chalk.green("Everything looks ready."));
  }
  console.log("");
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
    .command("doctor")
    .description("Check Tool Studio's readiness: Cloud Foundry login, GitLab login, saved BTP service credentials, and deploy targets")
    .action(runToolDoctorCommand);

  tool
    .command("import-legacy-config")
    .description("Best-effort seed Deploy Targets / BTP service credentials from the legacy tool's environment.json / btp-space.json")
    .option("--environment <path>", "Path to the legacy environment.json")
    .option("--btp-space <path>", "Path to the legacy btp-space.json")
    .action(runImportLegacyConfigCommand);
}
