import path from "node:path";
import fs from "fs-extra";
import type { TDoctorPackageResult, TPackageOccurrence } from "./types";

async function findPackageJsonFiles(startPath: string, packageName: string): Promise<string[]> {
  const packagePathParts = packageName.startsWith("@") ? packageName.split("/") : [packageName];
  const result: string[] = [];

  async function walk(directoryPath: string, depth: number): Promise<void> {
    if (depth > 8) {
      return;
    }

    const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      if (entry.name === ".git") {
        continue;
      }

      const entryPath = path.join(directoryPath, entry.name);

      if (entry.name === "node_modules") {
        const packageJsonPath = path.join(entryPath, ...packagePathParts, "package.json");

        if (await fs.pathExists(packageJsonPath)) {
          result.push(packageJsonPath);
        }

        await walk(entryPath, depth + 1);
        continue;
      }

      if (entry.name.startsWith(".")) {
        continue;
      }

      await walk(entryPath, depth + 1);
    }
  }

  await walk(startPath, 0);
  return result;
}

export async function doctorPackage(options: { repositoryPath: string; packageName: string }): Promise<TDoctorPackageResult> {
  const packageJsonFiles = await findPackageJsonFiles(options.repositoryPath, options.packageName);
  const occurrences: TPackageOccurrence[] = [];

  for (const packageJsonFile of packageJsonFiles) {
    const packageJson = await fs.readJson(packageJsonFile).catch(() => undefined) as { version?: string } | undefined;
    occurrences.push({
      version: packageJson?.version,
      path: packageJsonFile,
    });
  }

  const versions = [...new Set(occurrences.map((item) => item.version).filter((version): version is string => Boolean(version)))];

  return {
    packageName: options.packageName,
    versions,
    occurrences,
    hasMultipleVersions: versions.length > 1,
  };
}
