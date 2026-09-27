import path from "node:path";
import fs from "fs-extra";
import prompts from "prompts";
import { resolveLocalVariableOption, toFileDependencySpecifier } from "./local-registry";
import { readNpmrcRegistryEntries } from "./npmrc";
import { readCache, rememberVariableValue } from "./cache";
import { scanRepositoryVariables } from "./scanner";

// Exported so tests can drive prompts.inject(...) with the exact sentinel
// this module branches on, instead of duplicating a magic string.
export const USE_LOCAL_VALUE = "__SMDG_USE_LOCAL__";
export const ENTER_NEW_VALUE = "__ENTER_NEW_VALUE__";

export async function askMissingVariables(options: {
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

  const packageJsonPath = path.join(options.repositoryPath, "package.json");
  const packageJsonContent = await fs.pathExists(packageJsonPath) ? await fs.readFile(packageJsonPath, "utf8") : undefined;
  const registryIdentity = (await readNpmrcRegistryEntries(path.join(options.repositoryPath, ".npmrc")))[0];

  for (const variableName of variableNames) {
    if (result[variableName]) {
      await rememberVariableValue(variableName, result[variableName]);
      continue;
    }

    const cachedValues = cache.variables[variableName] ?? [];
    const localOption = packageJsonContent
      ? await resolveLocalVariableOption({ packageJsonContent, variableName, registryIdentity })
      : undefined;

    if (cachedValues.length > 0 || localOption) {
      const response = await prompts({
        type: "select",
        name: "selectedValue",
        message: `Value for ${variableName}`,
        choices: [
          ...(localOption
            ? [{ title: `Use local package: ${localOption.packageName}@${localOption.version} (published ${localOption.publishedAt})`, value: USE_LOCAL_VALUE }]
            : []),
          ...cachedValues.map((value) => ({ title: value, value })),
          { title: "Enter new value", value: ENTER_NEW_VALUE },
        ],
        initial: 0,
      });

      if (!response.selectedValue) {
        throw new Error(`Missing value for ${variableName}`);
      }

      if (response.selectedValue === USE_LOCAL_VALUE && localOption) {
        // A local tarball path is a one-off, machine-specific value — remember
        // it for this install run only, never into the normal value history
        // (unlike a real tag/version, it wouldn't mean anything on a re-run
        // from a different machine or once the local publish is cleared).
        result[variableName] = toFileDependencySpecifier(localOption.tarballPath);
        continue;
      }

      if (response.selectedValue !== ENTER_NEW_VALUE) {
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
