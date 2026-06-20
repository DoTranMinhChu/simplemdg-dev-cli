#!/usr/bin/env node

import path from "node:path";
import { Command } from "commander";
import prompts from "prompts";
import fs from "fs-extra";
import { askRootHelpMode, openUserGuideInBrowser, printUserGuide } from "./core/guide";
import { installRepository } from "./core/install";
import { scanRepositoryVariables } from "./core/scanner";
import { doctorPackage } from "./core/doctor";
import {
  readCache,
  rememberOverrideValue,
  rememberVariableValue,
} from "./core/cache";
import { resolveRepositoryPath } from "./core/repository";
import {
  inspectPackageConflicts,
  parseLoadedLocationConflicts,
  rememberResolvedOverrideVersions,
} from "./core/version-conflict";
import { registerCloudFoundryCommands } from "./commands/cf.command";
import { registerCdsCommands } from "./commands/cds.command";
import { registerNpmrcCommands } from "./commands/npmrc.command";
import { registerGitLabCommands } from "./commands/gitlab.command";
import { registerCacheCommands } from "./commands/cache.command";
import { enableInteractiveNavigation, runGroupNavigator } from "./core/navigator";
import type { TInstallCommandOptions, TKeyValueMap } from "./types-local";

const program = new Command();

function parseKeyValueList(values: string[] | undefined): TKeyValueMap {
  const result: TKeyValueMap = {};

  for (const value of values ?? []) {
    const index = value.indexOf("=");

    if (index === -1) {
      throw new Error(`Invalid key=value: ${value}`);
    }

    const key = value.slice(0, index).trim();
    const keyValue = value.slice(index + 1).trim();

    if (!key || !keyValue) {
      throw new Error(`Invalid key=value: ${value}`);
    }

    result[key] = keyValue;
  }

  return result;
}

async function askMissingVariables(options: {
  repositoryPath: string;
  filePatterns: string[];
  providedValues: Record<string, string>;
}): Promise<Record<string, string>> {
  const scannedVariables = await scanRepositoryVariables({
    repositoryPath: options.repositoryPath,
    filePatterns: options.filePatterns,
  });

  const variableNames = [...new Set(scannedVariables.map((item) => item.variableName))];
  const cache = await readCache();
  const result: Record<string, string> = { ...options.providedValues };

  if (variableNames.length === 0) {
    console.log("No package variables found.");
    return result;
  }

  console.log("");
  console.log("Detected package variables:");

  for (const variableName of variableNames) {
    const occurrences = scannedVariables
      .filter((item) => item.variableName === variableName)
      .reduce((total, item) => total + item.occurrences, 0);

    console.log(`- ${variableName} (${occurrences} occurrence(s))`);
  }

  console.log("");

  for (const variableName of variableNames) {
    if (result[variableName]) {
      await rememberVariableValue(variableName, result[variableName]);
      continue;
    }

    const cachedValues = cache.variables[variableName] ?? [];

    if (cachedValues.length > 0) {
      const response = await prompts({
        type: "select",
        name: "selectedValue",
        message: `Value for ${variableName}`,
        choices: [
          ...cachedValues.map((value) => ({ title: value, value })),
          { title: "Enter new value", value: "__ENTER_NEW_VALUE__" },
        ],
        initial: 0,
      });

      if (!response.selectedValue) {
        throw new Error(`Missing value for ${variableName}`);
      }

      if (response.selectedValue !== "__ENTER_NEW_VALUE__") {
        result[variableName] = response.selectedValue as string;
        await rememberVariableValue(variableName, response.selectedValue as string);
        continue;
      }
    }

    const response = await prompts({
      type: "text",
      name: "value",
      message: `Enter value for ${variableName}`,
      initial: cachedValues[0] ?? "",
      validate: (value: string) => value?.trim() ? true : `${variableName} is required`,
    });

    if (!response.value) {
      throw new Error(`Missing value for ${variableName}`);
    }

    result[variableName] = response.value as string;
    await rememberVariableValue(variableName, response.value as string);
  }

  return result;
}

async function askOverrideVersion(options: {
  packageName: string;
  suggestedVersions: string[];
  reason: string;
}): Promise<string | undefined> {
  console.log("");
  console.log(`Detected package conflict: ${options.packageName}`);
  console.log(options.reason);
  console.log("");

  const choices = [
    ...options.suggestedVersions.map((version) => ({ title: version, value: version })),
    { title: "Enter new version", value: "__ENTER_NEW_VERSION__" },
    { title: "Skip", value: "__SKIP__" },
  ];

  const response = await prompts({
    type: "select",
    name: "value",
    message: `Override version for ${options.packageName}`,
    choices,
    initial: 0,
  });

  if (!response.value || response.value === "__SKIP__") {
    return undefined;
  }

  if (response.value !== "__ENTER_NEW_VERSION__") {
    return response.value as string;
  }

  const input = await prompts({
    type: "text",
    name: "version",
    message: `Enter version for ${options.packageName}`,
    initial: options.suggestedVersions[0] ?? "",
    validate: (value: string) => value?.trim() ? true : "Version is required",
  });

  return input.version as string | undefined;
}

async function askOverridesFromDoctor(options: {
  repositoryPath: string;
  packageNames: string[];
  currentOverrides: Record<string, string>;
}): Promise<Record<string, string>> {
  const overrides: Record<string, string> = { ...options.currentOverrides };
  const conflicts = await inspectPackageConflicts({
    repositoryPath: options.repositoryPath,
    packageNames: options.packageNames,
  });

  for (const conflict of conflicts) {
    if (overrides[conflict.packageName]) {
      continue;
    }

    const selectedVersion = await askOverrideVersion({
      packageName: conflict.packageName,
      suggestedVersions: conflict.suggestedVersions,
      reason: [
        `Found ${conflict.doctorResult.occurrences.length} installed location(s).`,
        `Versions: ${conflict.doctorResult.versions.join(", ") || "unknown"}`,
        `This may cause "was loaded from different locations" errors.`,
      ].join("\n"),
    });

    if (selectedVersion) {
      overrides[conflict.packageName] = selectedVersion;
    }
  }

  await rememberResolvedOverrideVersions(overrides);
  return overrides;
}

async function askOverridesFromLoadedLocationError(options: {
  repositoryPath: string;
  output: string;
  currentOverrides: Record<string, string>;
}): Promise<Record<string, string>> {
  const overrides: Record<string, string> = { ...options.currentOverrides };
  const conflicts = parseLoadedLocationConflicts(options.output);

  for (const conflict of conflicts) {
    if (overrides[conflict.packageName]) {
      continue;
    }

    const doctorConflicts = await inspectPackageConflicts({
      repositoryPath: options.repositoryPath,
      packageNames: [conflict.packageName],
    });

    const suggestedVersions = doctorConflicts[0]?.suggestedVersions ?? [];
    const selectedVersion = await askOverrideVersion({
      packageName: conflict.packageName,
      suggestedVersions,
      reason: conflict.rawMessage,
    });

    if (selectedVersion) {
      overrides[conflict.packageName] = selectedVersion;
    }
  }

  await rememberResolvedOverrideVersions(overrides);
  return overrides;
}

async function runInstallCommand(options: TInstallCommandOptions): Promise<void> {
  const repositoryPath = await resolveRepositoryPath(options.cwd ?? process.cwd());
  const installCommand = options.cmd ?? "npm install";
  const filePatterns = options.pattern ?? ["package.json"];
  const providedVariableValues = parseKeyValueList(options.set);
  let temporaryOverrides = parseKeyValueList(options.override);

  const variableValues = await askMissingVariables({
    repositoryPath,
    filePatterns,
    providedValues: providedVariableValues,
  });

  const checkPackageNames = options.checkPackage?.length ? options.checkPackage : ["@sap/cds"];

  if (options.autoDoctor !== false) {
    temporaryOverrides = await askOverridesFromDoctor({
      repositoryPath,
      packageNames: checkPackageNames,
      currentOverrides: temporaryOverrides,
    });
  }

  for (const [packageName, version] of Object.entries(temporaryOverrides)) {
    await rememberOverrideValue(packageName, version);
  }

  let installResult = await installRepository({
    repositoryPath,
    installCommand,
    variableValues,
    temporaryOverrides,
    filePatterns,
    onLog: (value) => process.stdout.write(value),
    onErrorLog: (value) => process.stderr.write(value),
  });

  const fullOutput = `${installResult.stdout}\n${installResult.stderr}`;
  const loadedLocationConflicts = parseLoadedLocationConflicts(fullOutput);

  if (loadedLocationConflicts.length > 0) {
    console.log("");
    console.log("Loaded-from-different-locations error detected.");
    console.log("The tool can retry install with temporary overrides.");
    console.log("");

    const nextOverrides = await askOverridesFromLoadedLocationError({
      repositoryPath,
      output: fullOutput,
      currentOverrides: temporaryOverrides,
    });

    const hasNewOverride = JSON.stringify(nextOverrides) !== JSON.stringify(temporaryOverrides);

    if (hasNewOverride) {
      console.log("");
      console.log("Retrying install with temporary overrides...");
      console.log("");

      installResult = await installRepository({
        repositoryPath,
        installCommand,
        variableValues,
        temporaryOverrides: nextOverrides,
        filePatterns,
        onLog: (value) => process.stdout.write(value),
        onErrorLog: (value) => process.stderr.write(value),
      });
    }
  }

  process.exitCode = installResult.exitCode;
}

function readCliVersion(): string {
  // Single source of truth: read the version from package.json at runtime so
  // `smdg -V` always matches the package. Works in dev (src via tsx) and when
  // installed (dist), since package.json sits one level up from this file.
  try {
    const packageJson = fs.readJsonSync(path.join(__dirname, "..", "package.json")) as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

program.name("simplemdg").description("SimpleMDG local development helper").version(readCliVersion());


program
  .command("guide")
  .alias("docs")
  .description("Open or print the SimpleMDG Dev CLI user guide")
  .option("--web", "Open the visual local guide in browser")
  .option("--terminal", "Print guide in terminal")
  .option("--port <port>", "Local guide server port")
  .action(async (options: { web?: boolean; terminal?: boolean; port?: string }) => {
    if (options.terminal) {
      await printUserGuide();
      return;
    }

    if (options.web) {
      await openUserGuideInBrowser(options.port);
      return;
    }

    const mode = await askRootHelpMode();

    if (mode === "web") {
      await openUserGuideInBrowser(options.port);
      return;
    }

    if (mode === "terminal") {
      await printUserGuide();
      return;
    }

    program.outputHelp();
  });

program
  .command("scan")
  .description("Scan current repository for ${VARIABLE_NAME} placeholders")
  .option("--cwd <path>", "Repository path", process.cwd())
  .option("--pattern <pattern...>", "File patterns", ["package.json"])
  .action(async (options: { cwd: string; pattern: string[] }) => {
    const repositoryPath = await resolveRepositoryPath(options.cwd);
    const scannedVariables = await scanRepositoryVariables({ repositoryPath, filePatterns: options.pattern });

    if (scannedVariables.length === 0) {
      console.log("No variables found.");
      return;
    }

    for (const item of scannedVariables) {
      console.log(`${item.variableName} | ${item.occurrences} occurrence(s) | ${item.filePath}`);
    }
  });

program
  .command("install")
  .alias("i")
  .description("Install current repository with temporary variable replacement and temporary overrides")
  .option("--cwd <path>", "Repository path", process.cwd())
  .option("--cmd <command>", "Install command", "npm install")
  .option("--set <keyValue...>", "Variable value. Example: --set SIMPLEMDG_BRANCH=sandbox")
  .option("--override <keyValue...>", "Temporary override. Example: --override @sap/cds=9.8.3")
  .option("--pattern <pattern...>", "File patterns", ["package.json"])
  .option("--check-package <packageName...>", "Packages to check for duplicated loaded locations", ["@sap/cds"])
  .option("--no-auto-doctor", "Disable automatic duplicated package inspection")
  .action(runInstallCommand);

program
  .command("doctor")
  .description("Inspect duplicated package versions in current repository")
  .option("--cwd <path>", "Repository path", process.cwd())
  .option("--package <packageName>", "Package name", "@sap/cds")
  .action(async (options: { cwd: string; package: string }) => {
    const repositoryPath = await resolveRepositoryPath(options.cwd);
    const result = await doctorPackage({ repositoryPath, packageName: options.package });

    console.log(`Package: ${result.packageName}`);
    console.log(`Versions: ${result.versions.join(", ") || "N/A"}`);
    console.log(`Occurrences: ${result.occurrences.length}`);

    for (const occurrence of result.occurrences) {
      console.log(`- ${occurrence.version ?? "unknown"} | ${occurrence.path ?? "unknown path"}`);
    }

    if (result.hasMultipleVersions || result.occurrences.length > 1) {
      console.log("");
      console.log("Suggestion:");
      console.log(`simplemdg install --override ${result.packageName}=<version>`);
      console.log("");
      console.log("Example:");
      console.log(`simplemdg install --override ${result.packageName}=9.8.3`);
    }
  });

registerCloudFoundryCommands(program);
registerCdsCommands(program);
registerNpmrcCommands(program);
registerGitLabCommands(program);
registerCacheCommands(program);

// Turn every group command (cf, cf db, cds, npmrc, gitlab, ...) into an
// interactive menu so a partial command like `smdg cf` or `smdg cf db` lists
// its subcommands to pick from instead of printing help.
enableInteractiveNavigation(program);

async function runCli(): Promise<void> {
  const userArguments = process.argv.slice(2);

  if (userArguments.length === 0) {
    await runGroupNavigator(program);
    return;
  }

  const isRootHelp = process.argv.length <= 3 && ["--help", "-h"].includes(process.argv[2] ?? "");

  if (isRootHelp) {
    const mode = await askRootHelpMode();

    if (mode === "web") {
      await openUserGuideInBrowser();
      return;
    }

    if (mode === "terminal") {
      await printUserGuide();
      return;
    }

    program.outputHelp();
    return;
  }

  await program.parseAsync();
}

runCli().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
