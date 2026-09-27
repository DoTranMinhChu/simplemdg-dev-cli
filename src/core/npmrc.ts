import path from "node:path";
import os from "node:os";
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

function stripSurroundingQuotes(value: string): string {
  let result = value.trim();

  // Windows Explorer's "Copy as path" wraps the value in double quotes, so a
  // path pasted straight into an already-quoted shell argument (or the
  // interactive prompt) keeps its literal quote characters. Peel off up to a
  // couple of matching layers rather than assuming a single wrap.
  for (let i = 0; i < 2; i += 1) {
    if (result.length >= 2 && (result.startsWith('"') && result.endsWith('"') || result.startsWith("'") && result.endsWith("'"))) {
      result = result.slice(1, -1).trim();
      continue;
    }

    break;
  }

  return result;
}

function expandHomeDirectory(value: string): string {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
}

export function resolveImportFilePath(cwd: string, rawInput: string): string {
  const cleanedInput = expandHomeDirectory(stripSurroundingQuotes(rawInput));
  return path.resolve(cwd, cleanedInput);
}

export function parsePackageIdList(input: string): string[] {
  return [...new Set(input
    .split(/[\s,;]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => /^\d+$/.test(value)))] ;
}

export type TParsedNpmrcRegistry = {
  scope: string;
  host: string;
  packageId: string;
};

const REGISTRY_LINE_PATTERN = /^(@[^\s:]+):registry=https?:\/\/([^/]+)\/api\/v4\/projects\/(\d+)\/packages\/npm\/?$/;

// Parses the `@scope:registry=...` line(s) `writeNpmrcFile` manages back into
// (host, packageId) — the exact GitLab project a repo's real `npm install`
// would hit for that scope. Reused to key the local publish store by the same
// identity, so a locally "published" package can never be served to a repo
// that isn't actually configured to install from that project's registry.
export async function readNpmrcRegistryEntries(npmrcPath: string): Promise<TParsedNpmrcRegistry[]> {
  if (!(await fs.pathExists(npmrcPath))) {
    return [];
  }

  const content = await fs.readFile(npmrcPath, "utf8");
  const entries: TParsedNpmrcRegistry[] = [];

  for (const line of content.split(/\r?\n/)) {
    const match = REGISTRY_LINE_PATTERN.exec(line.trim());

    if (match) {
      entries.push({ scope: match[1], host: match[2], packageId: match[3] });
    }
  }

  return entries;
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
