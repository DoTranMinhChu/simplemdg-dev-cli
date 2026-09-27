import path from "node:path";
import os from "node:os";
import fs from "fs-extra";
import { execa } from "execa";
import type { TLocalPublishRecord, TLocalRegistryKey, TLocalVariableOption } from "./types";

const METADATA_FILE_NAME = "local.json";

// Read lazily (not a module-level constant) so tests can point this at a
// throwaway directory via SMDG_LOCAL_REGISTRY_ROOT instead of ever writing
// real tarballs under the developer's actual ~/.simplemdg.
export function getLocalRegistryRoot(): string {
  return process.env.SMDG_LOCAL_REGISTRY_ROOT?.trim() || path.join(os.homedir(), ".simplemdg", "local-registry");
}

function keyDirectory(key: TLocalRegistryKey): string {
  return path.join(getLocalRegistryRoot(), key.host, key.packageId, key.packageName);
}

export async function readLocalPublishRecord(key: TLocalRegistryKey): Promise<TLocalPublishRecord | undefined> {
  const metadataPath = path.join(keyDirectory(key), METADATA_FILE_NAME);

  if (!(await fs.pathExists(metadataPath))) {
    return undefined;
  }

  return fs.readJson(metadataPath).catch(() => undefined) as Promise<TLocalPublishRecord | undefined>;
}

export async function resolveLocalTarballPath(key: TLocalRegistryKey): Promise<string | undefined> {
  const record = await readLocalPublishRecord(key);

  if (!record) {
    return undefined;
  }

  const tarballPath = path.join(keyDirectory(key), record.tarballFileName);
  return (await fs.pathExists(tarballPath)) ? tarballPath : undefined;
}

export type TPublishLocalPackageOptions = {
  repositoryPath: string;
  host: string;
  packageId: string;
  onLog?: (value: string) => void;
};

export type TPublishLocalPackageResult = {
  packageName: string;
  version: string;
  tarballPath: string;
};

export async function publishLocalPackage(options: TPublishLocalPackageOptions): Promise<TPublishLocalPackageResult> {
  const packageJsonPath = path.join(options.repositoryPath, "package.json");

  if (!(await fs.pathExists(packageJsonPath))) {
    throw new Error(`No package.json found at ${options.repositoryPath}`);
  }

  const packageJson = await fs.readJson(packageJsonPath) as { name?: string; version?: string };

  if (!packageJson.name) {
    throw new Error(`package.json at ${packageJsonPath} has no "name" field`);
  }

  const packageName = packageJson.name;
  const version = packageJson.version ?? "0.0.0";
  const targetDirectory = keyDirectory({ host: options.host, packageId: options.packageId, packageName });
  await fs.ensureDir(targetDirectory);

  const packResult = await execa("npm", ["pack", "--pack-destination", targetDirectory, "--json"], {
    cwd: options.repositoryPath,
    reject: false,
  });

  options.onLog?.(packResult.stdout ?? "");

  if (packResult.exitCode !== 0) {
    throw new Error(`npm pack failed (exit ${packResult.exitCode ?? "unknown"}):\n${packResult.stderr || packResult.stdout}`);
  }

  let tarballFileName: string | undefined;

  try {
    const packInfo = JSON.parse(packResult.stdout) as Array<{ filename?: string }>;
    tarballFileName = packInfo[0]?.filename;
  } catch {
    tarballFileName = undefined;
  }

  if (!tarballFileName) {
    throw new Error("npm pack did not report an output file name");
  }

  const tarballPath = path.join(targetDirectory, tarballFileName);

  // The store only ever keeps the latest local publish per (host, packageId,
  // packageName) — it simulates "what would `npm install` fetch right now",
  // not a version history — so any previous tarball under this key is stale.
  const existingFileNames = await fs.readdir(targetDirectory);

  for (const fileName of existingFileNames) {
    if (fileName.endsWith(".tgz") && fileName !== tarballFileName) {
      await fs.remove(path.join(targetDirectory, fileName));
    }
  }

  const record: TLocalPublishRecord = {
    packageName,
    version,
    host: options.host,
    packageId: options.packageId,
    publishedAt: new Date().toISOString(),
    tarballFileName,
  };

  await fs.writeJson(path.join(targetDirectory, METADATA_FILE_NAME), record, { spaces: 2 });

  return { packageName, version, tarballPath };
}

export async function listLocalPublishRecords(): Promise<TLocalPublishRecord[]> {
  const registryRoot = getLocalRegistryRoot();

  if (!(await fs.pathExists(registryRoot))) {
    return [];
  }

  const metadataPaths = await findMetadataFiles(registryRoot);
  const records: TLocalPublishRecord[] = [];

  for (const metadataPath of metadataPaths) {
    const record = await fs.readJson(metadataPath).catch(() => undefined) as TLocalPublishRecord | undefined;

    if (record) {
      records.push(record);
    }
  }

  return records.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

async function findMetadataFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      results.push(...await findMetadataFiles(entryPath));
      continue;
    }

    if (entry.name === METADATA_FILE_NAME) {
      results.push(entryPath);
    }
  }

  return results;
}

export async function removeLocalPublishRecord(key: TLocalRegistryKey): Promise<boolean> {
  const directory = keyDirectory(key);

  if (!(await fs.pathExists(directory))) {
    return false;
  }

  await fs.remove(directory);
  return true;
}

export function findPackageNamesForVariable(packageJsonContent: string, variableName: string): string[] {
  const escapedVariableName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`"([^"]+)"\\s*:\\s*"\\$\\{${escapedVariableName}\\}"`, "g");
  const packageNames = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(packageJsonContent)) !== null) {
    packageNames.add(match[1]);
  }

  return [...packageNames];
}

export async function resolveLocalVariableOption(options: {
  packageJsonContent: string;
  variableName: string;
  registryIdentity: { host: string; packageId: string } | undefined;
}): Promise<TLocalVariableOption | undefined> {
  if (!options.registryIdentity) {
    return undefined;
  }

  const packageNames = findPackageNamesForVariable(options.packageJsonContent, options.variableName);

  for (const packageName of packageNames) {
    const key: TLocalRegistryKey = { host: options.registryIdentity.host, packageId: options.registryIdentity.packageId, packageName };
    const record = await readLocalPublishRecord(key);

    if (!record) {
      continue;
    }

    const tarballPath = await resolveLocalTarballPath(key);

    if (tarballPath) {
      return { packageName, version: record.version, publishedAt: record.publishedAt, tarballPath };
    }
  }

  return undefined;
}

export function toFileDependencySpecifier(tarballPath: string): string {
  return `file:${tarballPath.split(path.sep).join("/")}`;
}
