import path from "node:path";
import fs from "fs-extra";
import fastGlob from "fast-glob";
import type { TScannedVariable } from "./types";

const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export async function scanRepositoryVariables(options: {
  repositoryPath: string;
  filePatterns: string[];
}): Promise<TScannedVariable[]> {
  const filePaths = await fastGlob(options.filePatterns, {
    cwd: options.repositoryPath,
    absolute: true,
    onlyFiles: true,
    ignore: ["node_modules/**", "dist/**", ".git/**"],
  });

  const result: TScannedVariable[] = [];

  for (const filePath of filePaths) {
    const content = await fs.readFile(filePath, "utf8");
    const occurrencesByVariable = new Map<string, number>();
    let match: RegExpExecArray | null;

    while ((match = VARIABLE_PATTERN.exec(content)) !== null) {
      const variableName = match[1];
      occurrencesByVariable.set(variableName, (occurrencesByVariable.get(variableName) ?? 0) + 1);
    }

    for (const [variableName, occurrences] of occurrencesByVariable.entries()) {
      result.push({
        variableName,
        occurrences,
        filePath: path.relative(options.repositoryPath, filePath),
      });
    }
  }

  return result.sort((left, right) => left.variableName.localeCompare(right.variableName));
}
