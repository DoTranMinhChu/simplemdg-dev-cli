import path from "node:path";
import fs from "fs-extra";
import fg from "fast-glob";

const DEFAULT_CAP_PROFILES = ["hybrid", "development", "production", "mock"];
const CAP_CONFIG_FILE_NAMES = [
  "package.json",
  ".cdsrc.json",
  ".cdsrc-private.json",
  "default-env.json",
  "default-envBTP.json",
];

function normalizeProfileName(value: string): string {
  return value.trim().replace(/^\[/, "").replace(/\]$/, "");
}

function addProfile(result: Set<string>, value: string | undefined): void {
  const profileName = normalizeProfileName(value ?? "");

  if (!profileName || profileName.startsWith("-") || profileName.includes("/")) {
    return;
  }

  result.add(profileName);
}

function collectProfilesFromText(text: string, result: Set<string>): void {
  const commandProfileRegex = /--profile(?:=|\s+)([A-Za-z0-9_.:-]+)/g;
  let commandMatch: RegExpExecArray | null;

  while ((commandMatch = commandProfileRegex.exec(text)) !== null) {
    addProfile(result, commandMatch[1]);
  }

  const bracketProfileRegex = /"\[([A-Za-z0-9_.:-]+)\]"\s*:/g;
  let bracketMatch: RegExpExecArray | null;

  while ((bracketMatch = bracketProfileRegex.exec(text)) !== null) {
    addProfile(result, bracketMatch[1]);
  }

  const plainProfileRegex = /"profile"\s*:\s*"([A-Za-z0-9_.:-]+)"/g;
  let plainMatch: RegExpExecArray | null;

  while ((plainMatch = plainProfileRegex.exec(text)) !== null) {
    addProfile(result, plainMatch[1]);
  }
}

async function collectProfilesFromPackageJson(repositoryPath: string, result: Set<string>): Promise<void> {
  const packageJsonPath = path.join(repositoryPath, "package.json");

  if (!(await fs.pathExists(packageJsonPath))) {
    return;
  }

  const packageJson = await fs.readJson(packageJsonPath).catch(() => undefined) as Record<string, unknown> | undefined;

  if (!packageJson) {
    return;
  }

  const scripts = packageJson.scripts;

  if (scripts && typeof scripts === "object") {
    for (const [scriptName, scriptCommand] of Object.entries(scripts as Record<string, unknown>)) {
      collectProfilesFromText(scriptName, result);

      if (typeof scriptCommand === "string") {
        collectProfilesFromText(scriptCommand, result);
      }
    }
  }

  const cdsConfig = packageJson.cds;

  if (cdsConfig) {
    collectProfilesFromText(JSON.stringify(cdsConfig), result);
  }
}

export async function scanCapProfiles(repositoryPath: string): Promise<string[]> {
  const result = new Set<string>();

  await collectProfilesFromPackageJson(repositoryPath, result);

  const configFilePaths = await fg(CAP_CONFIG_FILE_NAMES, {
    cwd: repositoryPath,
    onlyFiles: true,
    dot: true,
    absolute: true,
    unique: true,
  });

  for (const filePath of configFilePaths) {
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    collectProfilesFromText(text, result);
  }

  for (const defaultProfile of DEFAULT_CAP_PROFILES) {
    if (result.has(defaultProfile)) {
      continue;
    }

    result.add(defaultProfile);
  }

  return [...result].sort((left, right) => {
    const defaultLeftIndex = DEFAULT_CAP_PROFILES.indexOf(left);
    const defaultRightIndex = DEFAULT_CAP_PROFILES.indexOf(right);

    if (defaultLeftIndex !== -1 || defaultRightIndex !== -1) {
      return (defaultLeftIndex === -1 ? 999 : defaultLeftIndex) - (defaultRightIndex === -1 ? 999 : defaultRightIndex);
    }

    return left.localeCompare(right);
  });
}

export type TCdsServiceDefinition = {
  serviceName: string;
  filePath: string;
  relativeFilePath: string;
  namespace?: string;
  fullServiceName: string;
};

const DEFAULT_CDS_SCAN_PATTERNS = [
  "srv/**/*.cds",
  "app/**/*.cds",
  "db/**/*.cds",
  "*.cds",
];

function stripCdsComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function collectNamespaceFromText(text: string): string | undefined {
  const namespaceMatch = /\bnamespace\s+([A-Za-z_$][A-Za-z0-9_.$]*)\s*;/m.exec(stripCdsComments(text));
  return namespaceMatch?.[1]?.trim();
}

function collectServicesFromText(text: string): string[] {
  const services = new Set<string>();
  const cleanedText = stripCdsComments(text);
  const serviceRegex = /\bservice\s+([A-Za-z_$][A-Za-z0-9_.$]*)\b/g;
  let match: RegExpExecArray | null;

  while ((match = serviceRegex.exec(cleanedText)) !== null) {
    const serviceName = match[1]?.trim();

    if (serviceName) {
      services.add(serviceName);
    }
  }

  return [...services];
}

function toFullServiceName(serviceName: string, namespace: string | undefined): string {
  if (!namespace || serviceName.includes(".")) {
    return serviceName;
  }

  return `${namespace}.${serviceName}`;
}

export async function scanCapServices(repositoryPath: string): Promise<TCdsServiceDefinition[]> {
  const cdsFilePaths = await fg(DEFAULT_CDS_SCAN_PATTERNS, {
    cwd: repositoryPath,
    onlyFiles: true,
    dot: true,
    absolute: true,
    unique: true,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/gen/**",
      "**/.git/**",
      "**/.cds/**",
    ],
  });

  const result: TCdsServiceDefinition[] = [];
  const keys = new Set<string>();

  for (const filePath of cdsFilePaths) {
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    const serviceNames = collectServicesFromText(text);
    const namespace = collectNamespaceFromText(text);
    const relativeFilePath = path.relative(repositoryPath, filePath).replace(/\\/g, "/");

    for (const serviceName of serviceNames) {
      const fullServiceName = toFullServiceName(serviceName, namespace);
      const key = `${fullServiceName}|${relativeFilePath}`;

      if (keys.has(key)) {
        continue;
      }

      keys.add(key);
      result.push({
        serviceName,
        filePath,
        relativeFilePath,
        namespace,
        fullServiceName,
      });
    }
  }

  return result.sort((left, right) => left.fullServiceName.localeCompare(right.fullServiceName));
}

export async function resolveDefaultCdsModel(repositoryPath: string): Promise<string> {
  const srvPath = path.join(repositoryPath, "srv");

  if (await fs.pathExists(srvPath)) {
    return "srv";
  }

  return ".";
}

function normalizeToSnakeCase(value: string): string {
  return value
    .replace(/^@[^/]+\//, "")
    .replace(/^simplemdg[-_]/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
}

async function readPackageName(repositoryPath: string): Promise<string | undefined> {
  const packageJsonPath = path.join(repositoryPath, "package.json");

  if (!(await fs.pathExists(packageJsonPath))) {
    return undefined;
  }

  const packageJson = await fs.readJson(packageJsonPath).catch(() => undefined) as { name?: unknown } | undefined;
  return typeof packageJson?.name === "string" ? packageJson.name : undefined;
}

export async function buildDefaultCompileOutputFileNames(options: {
  repositoryPath: string;
  serviceName?: string;
  to: string;
}): Promise<string[]> {
  const extension = options.to === "edmx" ? "xml" : options.to;
  const names = new Set<string>();
  const packageName = await readPackageName(options.repositoryPath);
  const folderName = path.basename(options.repositoryPath);

  if (packageName) {
    names.add(`${normalizeToSnakeCase(packageName)}.${extension}`);
  }

  if (folderName) {
    names.add(`${normalizeToSnakeCase(folderName)}.${extension}`);
  }

  if (options.serviceName) {
    names.add(`${normalizeToSnakeCase(options.serviceName)}.${extension}`);
  }

  return [...names].filter((value) => value !== `.${extension}`);
}

export function buildDefaultEdmxOutputFileName(serviceName: string): string {
  return `${normalizeToSnakeCase(serviceName)}.xml`;
}
