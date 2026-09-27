import path from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { rememberNpmrcHost, rememberNpmrcPackages, rememberNpmrcScope } from "../core/cache";
import {
  listLocalPublishRecords,
  publishLocalPackage,
  removeLocalPublishRecord,
} from "../core/local-registry";
import { normalizeGitLabHost, normalizeNpmScope, readNpmrcRegistryEntries } from "../core/npmrc";
import { searchableSelectChoice } from "../core/prompts";
import { resolveRepositoryPath } from "../core/repository";
import { askHost, askPackageEntry, askScope, resolveCurrentProjectName } from "./npmrc.command";

type TLocalPublishOptions = {
  cwd?: string;
  npmrcFile?: string;
  host?: string;
  scope?: string;
  packageId?: string;
};

type TLocalClearOptions = {
  package?: string;
  host?: string;
  packageId?: string;
  all?: boolean;
};

type TRegistryIdentity = {
  host: string;
  scope: string;
  packageId: string;
};

async function resolveRegistryIdentity(options: {
  repositoryPath: string;
  npmrcFileName: string;
  providedHost?: string;
  providedScope?: string;
  providedPackageId?: string;
}): Promise<TRegistryIdentity> {
  if (options.providedHost?.trim() && options.providedScope?.trim() && options.providedPackageId?.trim()) {
    return {
      host: normalizeGitLabHost(options.providedHost),
      scope: normalizeNpmScope(options.providedScope),
      packageId: options.providedPackageId.trim(),
    };
  }

  const npmrcPath = path.join(options.repositoryPath, options.npmrcFileName);
  const entries = await readNpmrcRegistryEntries(npmrcPath);

  if (entries.length > 0) {
    return entries[0];
  }

  console.log(`No GitLab package registry found in ${npmrcPath}.`);
  console.log("Tell the tool which registry this repo really publishes to, so the local store is keyed the same way a real install would resolve it.");
  console.log("");

  const projectName = await resolveCurrentProjectName(options.repositoryPath);
  const host = await askHost(options.providedHost);
  const scope = await askScope(options.providedScope);
  const packageEntry = await askPackageEntry({
    projectName,
    host,
    scope,
    providedPackageId: options.providedPackageId,
  });

  await rememberNpmrcHost(host);
  await rememberNpmrcScope(scope);
  await rememberNpmrcPackages(projectName, [packageEntry]);

  return { host, scope, packageId: packageEntry.packageId };
}

async function publishLocal(options: TLocalPublishOptions): Promise<void> {
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const npmrcFileName = options.npmrcFile?.trim() || ".npmrc";

  const identity = await resolveRegistryIdentity({
    repositoryPath,
    npmrcFileName,
    providedHost: options.host,
    providedScope: options.scope,
    providedPackageId: options.packageId,
  });

  console.log(chalk.gray(`Packing ${repositoryPath} ...`));
  console.log("");

  const result = await publishLocalPackage({
    repositoryPath,
    host: identity.host,
    packageId: identity.packageId,
    onLog: (value) => process.stdout.write(value),
  });

  console.log("");
  console.log(chalk.green(`Published locally: ${result.packageName}@${result.version}`));
  console.log(`Registry identity: ${identity.host} / project ${identity.packageId}`);
  console.log(`Store: ${result.tarballPath}`);
  console.log("");
  console.log(`Run "smdg i" in a consumer repo whose .npmrc points at the same registry (${identity.host} / project ${identity.packageId}) and pick "Use local package" when prompted for ${result.packageName}'s version.`);
}

async function listLocal(): Promise<void> {
  const records = await listLocalPublishRecords();

  if (records.length === 0) {
    console.log('No locally published packages yet. Run "smdg local publish" inside a helper repo first.');
    return;
  }

  console.log("Locally published packages:");
  console.log("");

  for (const record of records) {
    console.log(`- ${record.packageName}@${record.version}`);
    console.log(`  registry: ${record.host} / project ${record.packageId}`);
    console.log(`  published: ${record.publishedAt}`);
  }
}

async function clearLocal(options: TLocalClearOptions): Promise<void> {
  const records = await listLocalPublishRecords();

  if (records.length === 0) {
    console.log("Nothing to clear.");
    return;
  }

  const hasFilter = Boolean(options.package?.trim() || options.host?.trim() || options.packageId?.trim());

  if (options.all || hasFilter) {
    const targets = records.filter((record) => {
      if (options.package?.trim() && record.packageName !== options.package.trim()) {
        return false;
      }

      if (options.host?.trim() && record.host !== normalizeGitLabHost(options.host)) {
        return false;
      }

      if (options.packageId?.trim() && record.packageId !== options.packageId.trim()) {
        return false;
      }

      return true;
    });

    if (targets.length === 0) {
      console.log("No locally published package matched that filter.");
      return;
    }

    for (const record of targets) {
      await removeLocalPublishRecord({ host: record.host, packageId: record.packageId, packageName: record.packageName });
      console.log(`Removed ${record.packageName}@${record.version} (${record.host} / project ${record.packageId}).`);
    }

    return;
  }

  const selectedKey = await searchableSelectChoice({
    message: "Remove which locally published package?",
    choices: records.map((record) => ({
      title: `${record.packageName}@${record.version} (${record.host} / project ${record.packageId})`,
      value: `${record.host}|${record.packageId}|${record.packageName}`,
    })),
    allowCustomValue: false,
  });

  const [host, packageId, packageName] = selectedKey.split("|");
  await removeLocalPublishRecord({ host, packageId, packageName });
  console.log(`Removed ${packageName} (${host} / project ${packageId}).`);
}

export function registerLocalRegistryCommands(program: Command): void {
  const localCommand = program
    .command("local")
    .description("Simulate publishing/installing @simplemdg packages locally, without hitting GitLab");

  localCommand
    .command("publish")
    .description('Pack the current repo and store it as a local package for "smdg i" to pick up')
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--npmrc-file <fileName>", "npmrc file to read the registry identity from", ".npmrc")
    .option("--host <host>", "GitLab host (only asked if this repo has no .npmrc yet)")
    .option("--scope <scope>", "NPM scope (only asked if this repo has no .npmrc yet)")
    .option("--package-id <packageId>", "GitLab project/package ID (only asked if this repo has no .npmrc yet)")
    .action(publishLocal);

  localCommand
    .command("list")
    .alias("ls")
    .description("List locally published packages")
    .action(listLocal);

  localCommand
    .command("clear")
    .alias("remove")
    .description("Remove one or all locally published packages")
    .option("--package <name>", "Package name to remove")
    .option("--host <host>", "Only remove entries for this GitLab host")
    .option("--package-id <packageId>", "Only remove entries for this GitLab project ID")
    .option("--all", "Remove every locally published package")
    .action(clearLocal);
}
