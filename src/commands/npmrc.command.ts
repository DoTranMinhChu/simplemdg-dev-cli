import path from "node:path";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import prompts from "prompts";
import {
  readCache,
  rememberNpmrcHost,
  rememberNpmrcOutputFileName,
  rememberNpmrcPackages,
  rememberNpmrcScope,
  rememberNpmrcTokenEntry,
} from "../core/cache";
import {
  normalizeGitLabHost,
  normalizeNpmScope,
  parsePackageInputList,
  readPackageJsonName,
  writeNpmrcFile,
} from "../core/npmrc";
import { searchableSelectChoice, searchableSelectOrInput } from "../core/prompts";
import { resolveRepositoryPath } from "../core/repository";
import type { TNpmrcPackageEntry, TNpmrcTokenEntry } from "../core/types";

const DEFAULT_PROJECT_NAME = "default";

const DEFAULT_HOST = "gitlab.simplemdg.com";
const DEFAULT_SCOPE = "@simplemdg";

type TNpmrcCreateOptions = {
  cwd?: string;
  scope?: string;
  host?: string;
  packageId?: string;
  packageName?: string;
  token?: string;
  tokenLabel?: string;
  out?: string;
  noSaveToken?: boolean;
  alwaysAuth?: boolean;
};

type TNpmrcImportOptions = {
  cwd?: string;
  project?: string;
  scope?: string;
  host?: string;
  ids?: string;
  file?: string;
};

type TNpmrcTokenOptions = {
  scope?: string;
  host?: string;
  token?: string;
  label?: string;
};

function validatePackageId(value: string): true | string {
  return /^\d+$/.test(value.trim()) ? true : "Package ID must be a number";
}

function validateNotEmpty(label: string): (value: string) => true | string {
  return (value: string) => value.trim() ? true : `${label} is required`;
}

export function maskToken(token: string): string {
  const trimmedToken = token.trim();

  if (trimmedToken.length <= 8) {
    return "********";
  }

  return `${trimmedToken.slice(0, 4)}...${trimmedToken.slice(-4)}`;
}

function buildPackageEntryTitle(entry: TNpmrcPackageEntry): string {
  return `${entry.packageName} (${entry.packageId}) - ${entry.scope} @ ${entry.host}`;
}

function buildTokenTitle(entry: TNpmrcTokenEntry): string {
  return `${entry.label} - ${entry.scope} @ ${entry.host} - ${maskToken(entry.token)}`;
}

function uniquePackageEntries(entries: TNpmrcPackageEntry[]): TNpmrcPackageEntry[] {
  const result: TNpmrcPackageEntry[] = [];
  const keys = new Set<string>();

  for (const entry of entries) {
    const key = `${entry.host}|${entry.scope}|${entry.packageId}`;

    if (keys.has(key)) {
      continue;
    }

    keys.add(key);
    result.push(entry);
  }

  return result;
}

async function resolveCurrentProjectName(cwd: string, explicitProjectName?: string): Promise<string> {
  if (explicitProjectName?.trim()) {
    return explicitProjectName.trim();
  }

  const repositoryPath = await resolveRepositoryPath(cwd);
  const packageJsonName = await readPackageJsonName(repositoryPath);

  return packageJsonName ?? path.basename(repositoryPath) ?? DEFAULT_PROJECT_NAME;
}

async function askHost(providedHost?: string): Promise<string> {
  if (providedHost?.trim()) {
    return normalizeGitLabHost(providedHost);
  }

  const cache = await readCache();
  return normalizeGitLabHost(await searchableSelectOrInput({
    message: "GitLab host",
    values: cache.npmrc.hosts,
    initialValue: cache.npmrc.hosts[0] ?? DEFAULT_HOST,
    validate: validateNotEmpty("Host"),
    customValueTitle: (value) => `Use typed host: ${value}`,
  }));
}

async function askScope(providedScope?: string): Promise<string> {
  if (providedScope?.trim()) {
    return normalizeNpmScope(providedScope);
  }

  const cache = await readCache();
  return normalizeNpmScope(await searchableSelectOrInput({
    message: "NPM scope",
    values: cache.npmrc.scopes,
    initialValue: cache.npmrc.scopes[0] ?? DEFAULT_SCOPE,
    validate: validateNotEmpty("Scope"),
    customValueTitle: (value) => `Use typed scope: ${value}`,
  }));
}

async function askPackageEntry(options: {
  projectName: string;
  host: string;
  scope: string;
  providedPackageId?: string;
  providedPackageName?: string;
}): Promise<TNpmrcPackageEntry> {
  const now = new Date().toISOString();

  if (options.providedPackageId?.trim()) {
    const validationResult = validatePackageId(options.providedPackageId);

    if (validationResult !== true) {
      throw new Error(validationResult);
    }

    const packageName = options.providedPackageName?.trim() || options.providedPackageId.trim();

    return {
      packageId: options.providedPackageId.trim(),
      packageName,
      host: options.host,
      scope: options.scope,
      updatedAt: now,
    };
  }

  const cache = await readCache();
  const projectPackages = cache.npmrc.packageIdsByProject[options.projectName]?.packages ?? [];
  const legacyProjectIds = cache.npmrc.packageIdsByProject[options.projectName]?.packageIds ?? [];
  const legacyProjectPackages = legacyProjectIds.map<TNpmrcPackageEntry>((packageId) => ({
    packageId,
    packageName: packageId,
    host: options.host,
    scope: options.scope,
    updatedAt: now,
  }));
  const globalPackages = cache.npmrc.packages ?? [];
  const legacyGlobalPackages = cache.npmrc.packageIds.map<TNpmrcPackageEntry>((packageId) => ({
    packageId,
    packageName: packageId,
    host: options.host,
    scope: options.scope,
    updatedAt: now,
  }));
  const packages = uniquePackageEntries([
    ...projectPackages,
    ...legacyProjectPackages,
    ...globalPackages,
    ...legacyGlobalPackages,
  ]);

  const selectedPackageId = await searchableSelectChoice({
    message: `GitLab package for ${options.projectName}`,
    choices: packages.map((entry) => ({
      title: buildPackageEntryTitle(entry),
      value: entry.packageId,
    })),
    validateCustomValue: validatePackageId,
    customValueTitle: (value) => `Use typed package ID: ${value}`,
  });

  const cachedPackage = packages.find((entry) => entry.packageId === selectedPackageId);

  if (cachedPackage) {
    return {
      ...cachedPackage,
      host: cachedPackage.host || options.host,
      scope: cachedPackage.scope || options.scope,
      updatedAt: now,
    };
  }

  const response = await prompts({
    type: "text",
    name: "packageName",
    message: `Package name for ${selectedPackageId}`,
    initial: options.providedPackageName ?? selectedPackageId,
    validate: validateNotEmpty("Package name"),
  });

  if (!response.packageName) {
    throw new Error("Package name is required");
  }

  return {
    packageId: selectedPackageId,
    packageName: String(response.packageName).trim(),
    host: options.host,
    scope: options.scope,
    updatedAt: now,
  };
}

async function askToken(options: {
  host: string;
  scope: string;
  providedToken?: string;
  providedLabel?: string;
}): Promise<TNpmrcTokenEntry> {
  const now = new Date().toISOString();

  if (options.providedToken?.trim()) {
    return {
      host: options.host,
      scope: options.scope,
      token: options.providedToken.trim(),
      label: options.providedLabel?.trim() || `${options.scope} @ ${options.host}`,
      updatedAt: now,
    };
  }

  const cache = await readCache();
  const scopedTokens = cache.npmrc.tokenEntries.filter((entry) => {
    return entry.host === options.host && entry.scope === options.scope;
  });
  const allTokens = cache.npmrc.tokenEntries;
  const legacyTokens = cache.npmrc.tokens.map<TNpmrcTokenEntry>((token, index) => ({
    host: options.host,
    scope: options.scope,
    token,
    label: `Legacy token ${index + 1}`,
    updatedAt: now,
  }));
  const tokens = [...scopedTokens, ...allTokens, ...legacyTokens];

  if (tokens.length > 0) {
    const selectedToken = await searchableSelectChoice({
      message: `GitLab npm auth token for ${options.scope} @ ${options.host}`,
      choices: tokens.map((entry) => ({
        title: buildTokenTitle(entry),
        value: entry.token,
      })),
      validateCustomValue: validateNotEmpty("Token"),
      customValueTitle: (value) => `Use typed token: ${maskToken(value)}`,
    });
    const cachedToken = tokens.find((entry) => entry.token === selectedToken);

    if (cachedToken) {
      return {
        ...cachedToken,
        host: options.host,
        scope: options.scope,
        updatedAt: now,
      };
    }

    return {
      host: options.host,
      scope: options.scope,
      token: selectedToken,
      label: options.providedLabel?.trim() || `${options.scope} @ ${options.host}`,
      updatedAt: now,
    };
  }

  const response = await prompts({
    type: "password",
    name: "token",
    message: `GitLab npm auth token for ${options.scope} @ ${options.host}`,
    validate: (value: string) => value.trim() ? true : "Token is required",
  });

  if (!response.token) {
    throw new Error("Token is required");
  }

  return {
    host: options.host,
    scope: options.scope,
    token: String(response.token).trim(),
    label: options.providedLabel?.trim() || `${options.scope} @ ${options.host}`,
    updatedAt: now,
  };
}

async function createNpmrc(options: TNpmrcCreateOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const projectName = await resolveCurrentProjectName(cwd);
  const cache = await readCache();
  const host = await askHost(options.host);
  const scope = await askScope(options.scope);
  const packageEntry = await askPackageEntry({
    projectName,
    host,
    scope,
    providedPackageId: options.packageId,
    providedPackageName: options.packageName,
  });
  const tokenEntry = await askToken({
    host,
    scope,
    providedToken: options.token,
    providedLabel: options.tokenLabel,
  });
  const outputFileName = options.out ?? await searchableSelectOrInput({
    message: "Output npmrc file",
    values: cache.npmrc.outputFileNames,
    initialValue: ".npmrc",
    validate: validateNotEmpty("Output file"),
    customValueTitle: (value) => `Use typed file name: ${value}`,
  });

  const outputPath = await writeNpmrcFile({
    host,
    scope,
    packageId: packageEntry.packageId,
    token: tokenEntry.token,
    outputFileName,
    alwaysAuth: options.alwaysAuth ?? true,
  });

  await rememberNpmrcHost(host);
  await rememberNpmrcScope(scope);
  await rememberNpmrcPackages(projectName, [packageEntry]);
  await rememberNpmrcOutputFileName(outputFileName);

  if (options.noSaveToken !== true) {
    await rememberNpmrcTokenEntry(tokenEntry);
  }

  console.log(`Created ${outputPath}`);
  console.log(`${scope}:registry=https://${host}/api/v4/projects/${packageEntry.packageId}/packages/npm/`);
  console.log(`Package: ${packageEntry.packageName} (${packageEntry.packageId})`);
  console.log(`Token: ${tokenEntry.label} (${maskToken(tokenEntry.token)})`);
}

async function importPackages(options: TNpmrcImportOptions): Promise<void> {
  const projectName = await resolveCurrentProjectName(options.cwd ?? process.cwd(), options.project);
  const host = await askHost(options.host);
  const scope = await askScope(options.scope);
  let rawInput = options.ids ?? "";

  if (options.file?.trim()) {
    const filePath = path.resolve(options.cwd ?? process.cwd(), options.file);
    const fileContent = await readFile(filePath, "utf8");
    rawInput = `${rawInput}\n${fileContent}`;
  }

  if (!rawInput.trim()) {
    const response = await prompts({
      type: "text",
      name: "packages",
      message: `Packages for ${projectName}. Use: name|id, name,id, or id only`,
      validate: (value: string) => parsePackageInputList(value).length > 0 ? true : "Enter at least one package ID",
    });

    if (!response.packages) {
      throw new Error("No packages entered");
    }

    rawInput = response.packages as string;
  }

  const parsedPackages = parsePackageInputList(rawInput);

  if (parsedPackages.length === 0) {
    throw new Error("No valid packages found. Package IDs must be numbers.");
  }

  const packageEntries = parsedPackages.map<TNpmrcPackageEntry>((entry) => ({
    packageId: entry.packageId,
    packageName: entry.packageName,
    host,
    scope,
    updatedAt: new Date().toISOString(),
  }));

  await rememberNpmrcHost(host);
  await rememberNpmrcScope(scope);
  await rememberNpmrcPackages(projectName, packageEntries);

  console.log(`Imported ${packageEntries.length} package(s) for ${projectName}:`);
  for (const entry of packageEntries) {
    console.log(`- ${entry.packageName} (${entry.packageId}) - ${entry.scope} @ ${entry.host}`);
  }
}

async function updateToken(options: TNpmrcTokenOptions): Promise<void> {
  const host = await askHost(options.host);
  const scope = await askScope(options.scope);
  const response = options.token?.trim()
    ? { token: options.token.trim(), label: options.label?.trim() || `${scope} @ ${host}` }
    : await prompts([
      {
        type: "password",
        name: "token",
        message: `New GitLab npm auth token for ${scope} @ ${host}`,
        validate: (value: string) => value.trim() ? true : "Token is required",
      },
      {
        type: "text",
        name: "label",
        message: "Token label",
        initial: options.label?.trim() || `${scope} @ ${host}`,
        validate: validateNotEmpty("Token label"),
      },
    ]);

  if (!response.token) {
    throw new Error("Token is required");
  }

  const tokenEntry: TNpmrcTokenEntry = {
    host,
    scope,
    token: String(response.token).trim(),
    label: String(response.label || `${scope} @ ${host}`).trim(),
    updatedAt: new Date().toISOString(),
  };

  await rememberNpmrcHost(host);
  await rememberNpmrcScope(scope);
  await rememberNpmrcTokenEntry(tokenEntry);

  console.log(`Updated token for ${scope} @ ${host}: ${tokenEntry.label} (${maskToken(tokenEntry.token)})`);
}

async function listNpmrcCache(): Promise<void> {
  const cache = await readCache();

  console.log("NPMRC cache");
  console.log("");
  console.log(`Hosts: ${cache.npmrc.hosts.join(", ") || "N/A"}`);
  console.log(`Scopes: ${cache.npmrc.scopes.join(", ") || "N/A"}`);
  console.log(`Output files: ${cache.npmrc.outputFileNames.join(", ") || "N/A"}`);
  console.log("");
  console.log("Tokens:");

  if (cache.npmrc.tokenEntries.length === 0 && cache.npmrc.tokens.length === 0) {
    console.log("- N/A");
  } else {
    for (const entry of cache.npmrc.tokenEntries) {
      console.log(`- ${entry.label}: ${entry.scope} @ ${entry.host} - ${maskToken(entry.token)}`);
    }

    if (cache.npmrc.tokens.length > 0) {
      console.log(`- Legacy tokens: ${cache.npmrc.tokens.length}`);
    }
  }

  console.log("");
  console.log("Global packages:");

  if (cache.npmrc.packages.length === 0 && cache.npmrc.packageIds.length === 0) {
    console.log("- N/A");
  } else {
    for (const entry of cache.npmrc.packages) {
      console.log(`- ${entry.packageName} (${entry.packageId}) - ${entry.scope} @ ${entry.host}`);
    }

    for (const packageId of cache.npmrc.packageIds.filter((packageId) => {
      return !cache.npmrc.packages.some((entry) => entry.packageId === packageId);
    })) {
      console.log(`- ${packageId} (${packageId})`);
    }
  }

  console.log("");
  console.log("Packages by project:");

  const projects = Object.values(cache.npmrc.packageIdsByProject);

  if (projects.length === 0) {
    console.log("- N/A");
    return;
  }

  for (const project of projects) {
    console.log(`- ${project.projectName}:`);

    if ((project.packages?.length ?? 0) === 0 && project.packageIds.length === 0) {
      console.log("  - N/A");
      continue;
    }

    for (const entry of project.packages ?? []) {
      console.log(`  - ${entry.packageName} (${entry.packageId}) - ${entry.scope} @ ${entry.host}`);
    }

    for (const packageId of project.packageIds.filter((packageId) => {
      return !(project.packages ?? []).some((entry) => entry.packageId === packageId);
    })) {
      console.log(`  - ${packageId} (${packageId})`);
    }
  }
}

export function registerNpmrcCommands(program: Command): void {
  const npmrcCommand = program
    .command("npmrc")
    .description("Create and cache .npmrc config for GitLab npm package registry");

  npmrcCommand
    .command("create")
    .alias("init")
    .description("Create .npmrc for @simplemdg GitLab package registry")
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--scope <scope>", "NPM scope. Example: @simplemdg")
    .option("--host <host>", "GitLab host")
    .option("--package-id <packageId>", "GitLab project/package ID")
    .option("--package-name <packageName>", "Human-readable package name for cache")
    .option("--token <token>", "GitLab package registry token")
    .option("--token-label <label>", "Human-readable token label")
    .option("--out <fileName>", "Output file", ".npmrc")
    .option("--no-save-token", "Do not cache token")
    .option("--no-always-auth", "Write always-auth=false")
    .action(createNpmrc);

  npmrcCommand
    .command("import")
    .alias("add")
    .description("Import many GitLab packages into cache with package names")
    .option("--cwd <path>", "Repository path", process.cwd())
    .option("--project <name>", "Project cache name")
    .option("--scope <scope>", "NPM scope. Example: @simplemdg")
    .option("--host <host>", "GitLab host")
    .option("--ids <ids>", "Packages separated by line. Examples: name|123 or name,123 or 123")
    .option("--file <path>", "Text file containing packages")
    .action(importPackages);

  npmrcCommand
    .command("token")
    .alias("update-token")
    .description("Add or update cached token for a scope and host")
    .option("--scope <scope>", "NPM scope. Example: @simplemdg")
    .option("--host <host>", "GitLab host")
    .option("--token <token>", "New token")
    .option("--label <label>", "Token label")
    .action(updateToken);

  npmrcCommand
    .command("list")
    .description("List cached npmrc values with package names")
    .action(listNpmrcCache);

  npmrcCommand
    .action(createNpmrc);
}
