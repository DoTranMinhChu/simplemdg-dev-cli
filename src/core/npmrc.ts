import path from "node:path";
import fs from "fs-extra";

export type TNpmrcConfig = {
  host: string;
  scope: string;
  packageId: string;
  token: string;
  outputFileName: string;
  alwaysAuth: boolean;
};

function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

export function normalizeNpmScope(scope: string): string {
  const trimmedScope = scope.trim();
  if (!trimmedScope) {
    throw new Error("Scope is required");
  }

  return trimmedScope.startsWith("@") ? trimmedScope : `@${trimmedScope}`;
}

export function normalizeGitLabHost(host: string): string {
  return trimSlashes(host.replace(/^https?:\/\//, ""));
}

export function buildGitLabNpmRegistryUrl(options: { host: string; packageId: string }): string {
  const host = normalizeGitLabHost(options.host);
  const packageId = options.packageId.trim();

  if (!/^\d+$/.test(packageId)) {
    throw new Error("Package ID must be a number");
  }

  return `https://${host}/api/v4/projects/${packageId}/packages/npm/`;
}

export function buildGitLabNpmAuthRegistryPath(options: { host: string; packageId: string }): string {
  const host = normalizeGitLabHost(options.host);
  const packageId = options.packageId.trim();

  if (!/^\d+$/.test(packageId)) {
    throw new Error("Package ID must be a number");
  }

  return `//${host}/api/v4/projects/${packageId}/packages/npm/`;
}

function removeExistingManagedLines(options: {
  currentContent: string;
  scope: string;
  host: string;
}): string[] {
  const normalizedScope = normalizeNpmScope(options.scope);
  const normalizedHost = normalizeGitLabHost(options.host);

  return options.currentContent
    .split(/\r?\n/)
    .filter((line) => {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        return false;
      }

      if (trimmedLine.startsWith(`${normalizedScope}:registry=`)) {
        return false;
      }

      if (trimmedLine.includes(`${normalizedHost}/api/v4/projects/`) && trimmedLine.includes("/packages/npm/:_authToken=")) {
        return false;
      }

      if (trimmedLine === "always-auth=true" || trimmedLine === "always-auth=false") {
        return false;
      }

      return true;
    });
}

export async function writeNpmrcFile(options: TNpmrcConfig): Promise<string> {
  const outputPath = path.resolve(process.cwd(), options.outputFileName);
  const existingContent = await fs.pathExists(outputPath) ? await fs.readFile(outputPath, "utf8") : "";
  const preservedLines = removeExistingManagedLines({
    currentContent: existingContent,
    scope: options.scope,
    host: options.host,
  });

  const scope = normalizeNpmScope(options.scope);
  const registryUrl = buildGitLabNpmRegistryUrl({ host: options.host, packageId: options.packageId });
  const authRegistryPath = buildGitLabNpmAuthRegistryPath({ host: options.host, packageId: options.packageId });

  const managedLines = [
    `${scope}:registry=${registryUrl}`,
    `${authRegistryPath}:_authToken=${options.token.trim()}`,
    `always-auth=${options.alwaysAuth ? "true" : "false"}`,
  ];

  const nextContent = [...preservedLines, ...managedLines].join("\n") + "\n";

  await fs.writeFile(outputPath, nextContent, "utf8");
  return outputPath;
}

export function parsePackageIdList(input: string): string[] {
  return [...new Set(input
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /^\d+$/.test(value)))] ;
}

export async function readPackageJsonName(repositoryPath: string): Promise<string | undefined> {
  const packageJsonPath = path.join(repositoryPath, "package.json");

  if (!(await fs.pathExists(packageJsonPath))) {
    return undefined;
  }

  const packageJson = await fs.readJson(packageJsonPath).catch(() => undefined) as { name?: string } | undefined;
  return packageJson?.name;
}

export type TParsedPackageInput = {
  packageId: string;
  packageName: string;
};

export function parsePackageInputList(input: string): TParsedPackageInput[] {
  const entries: TParsedPackageInput[] = [];
  const keys = new Set<string>();

  for (const rawLine of input.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      continue;
    }

    const tokens = trimmedLine.split(/[|,;\t]+/).map((value) => value.trim()).filter(Boolean);
    const firstNumericTokenIndex = tokens.findIndex((value) => /^\d+$/.test(value));

    if (firstNumericTokenIndex >= 0) {
      const packageId = tokens[firstNumericTokenIndex];
      const packageNameTokens = tokens.filter((_, index) => index !== firstNumericTokenIndex);
      const packageName = packageNameTokens.join(" - ").trim() || packageId;
      const key = packageId;

      if (!keys.has(key)) {
        keys.add(key);
        entries.push({ packageId, packageName });
      }

      continue;
    }

    for (const packageId of parsePackageIdList(trimmedLine)) {
      if (!keys.has(packageId)) {
        keys.add(packageId);
        entries.push({ packageId, packageName: packageId });
      }
    }
  }

  return entries;
}
