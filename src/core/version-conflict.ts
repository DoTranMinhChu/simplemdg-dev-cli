import { doctorPackage } from "./doctor";
import { rememberResolvedOverrideVersions } from "./cache";
import type { TLoadedLocationConflict, TPackageConflictInspection } from "./types";

export { rememberResolvedOverrideVersions };

export function parseLoadedLocationConflicts(output: string): TLoadedLocationConflict[] {
  const result: TLoadedLocationConflict[] = [];
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    if (!/loaded from different locations/i.test(line)) {
      continue;
    }

    const packageMatch = line.match(/(@[\w.-]+\/[\w.-]+|[\w.-]+)(?=(?:\s|['"`]|,|:))/);

    result.push({
      packageName: packageMatch?.[1] ?? "@sap/cds",
      rawMessage: line.trim(),
    });
  }

  return result;
}

export async function inspectPackageConflicts(options: {
  repositoryPath: string;
  packageNames: string[];
}): Promise<TPackageConflictInspection[]> {
  const result: TPackageConflictInspection[] = [];

  for (const packageName of options.packageNames) {
    const doctorResult = await doctorPackage({ repositoryPath: options.repositoryPath, packageName });

    if (doctorResult.hasMultipleVersions || doctorResult.occurrences.length > 1) {
      result.push({
        packageName,
        doctorResult,
        suggestedVersions: doctorResult.versions,
      });
    }
  }

  return result;
}
