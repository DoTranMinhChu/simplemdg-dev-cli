import fs from "fs-extra";
import fastGlob from "fast-glob";
import { execa } from "execa";
import { splitCommand } from "./process";
import type { TInstallRepositoryOptions, TInstallRepositoryResult } from "./types";

function replaceVariables(content: string, variableValues: Record<string, string>): string {
  return content.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (fullMatch: string, variableName: string) => {
    return variableValues[variableName] ?? fullMatch;
  });
}

function mergePackageOverrides(packageJson: Record<string, unknown>, temporaryOverrides: Record<string, string>): Record<string, unknown> {
  if (Object.keys(temporaryOverrides).length === 0) {
    return packageJson;
  }

  const currentOverrides = typeof packageJson.overrides === "object" && packageJson.overrides !== null && !Array.isArray(packageJson.overrides)
    ? packageJson.overrides as Record<string, unknown>
    : {};

  return {
    ...packageJson,
    overrides: {
      ...currentOverrides,
      ...temporaryOverrides,
    },
  };
}

export async function installRepository(options: TInstallRepositoryOptions): Promise<TInstallRepositoryResult> {
  const filePaths = await fastGlob(options.filePatterns, {
    cwd: options.repositoryPath,
    absolute: true,
    onlyFiles: true,
    ignore: ["node_modules/**", "dist/**", ".git/**"],
  });

  const originalContents = new Map<string, string>();

  try {
    for (const filePath of filePaths) {
      const originalContent = await fs.readFile(filePath, "utf8");
      originalContents.set(filePath, originalContent);
      let nextContent = replaceVariables(originalContent, options.variableValues);

      if (filePath.endsWith("package.json")) {
        const packageJson = JSON.parse(nextContent) as Record<string, unknown>;
        nextContent = `${JSON.stringify(mergePackageOverrides(packageJson, options.temporaryOverrides), null, 2)}\n`;
      }

      if (nextContent !== originalContent) {
        await fs.writeFile(filePath, nextContent, "utf8");
      }
    }

    const { command, args } = splitCommand(options.installCommand);
    const childProcess = execa(command, args, {
      cwd: options.repositoryPath,
      reject: false,
      all: false,
    });

    let stdout = "";
    let stderr = "";

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      stdout += value;
      options.onLog?.(value);
    });

    childProcess.stderr?.on("data", (chunk: Buffer) => {
      const value = chunk.toString();
      stderr += value;
      options.onErrorLog?.(value);
    });

    const result = await childProcess;

    return {
      stdout,
      stderr,
      exitCode: result.exitCode ?? 0,
    };
  } finally {
    for (const [filePath, content] of originalContents.entries()) {
      await fs.writeFile(filePath, content, "utf8");
    }
  }
}
