import path from "node:path";
import fs from "fs-extra";
import { execa } from "execa";
import { runKnownFixups } from "./cds-upgrade-fixups";
import type { TCdsFixupContext, TCdsFixupResult } from "./cds-upgrade-fixups";

/**
 * `installRepository()` (`src/core/install.ts`) can't be reused here — it
 * unconditionally reverts every touched file (including `package.json`) in a
 * `finally` block since it's designed for ephemeral variable substitution,
 * targets an `overrides` block rather than a real dependency bump, and has
 * no timeout. This is a durable bump: the written `package.json` must
 * survive so it can be committed.
 */

const CDS_PACKAGE_NAMES = ["@sap/cds", "@sap/cds-dk", "@sap/cds-compiler"] as const;
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "overrides"] as const;

export type TCdsBumpResult = {
  changed: boolean;
  /** `"<section>.<packageName>"` -> version string, before and after. */
  before: Record<string, string>;
  after: Record<string, string>;
  fixups: TCdsFixupResult[];
};

function majorOf(versionRange: string | undefined): number {
  return Number(versionRange?.match(/(\d+)/)?.[1] ?? 0);
}

/** Rewrites every `@sap/cds`/`@sap/cds-dk`/`@sap/cds-compiler` entry found in `dependencies`/`devDependencies`/`overrides` to `targetVersion`, preserving each entry's existing range prefix (`^`/`~`/exact), then applies the known-fixups ruleset against the same in-memory object before one write-back. */
export async function bumpCdsPackageJson(repoPath: string, targetVersion: string): Promise<TCdsBumpResult> {
  const packageJsonPath = path.join(repoPath, "package.json");
  const packageJson = (await fs.readJson(packageJsonPath)) as Record<string, unknown>;

  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  let changed = false;
  let fromMajor = 0;

  for (const section of DEPENDENCY_SECTIONS) {
    const record = packageJson[section];
    if (typeof record !== "object" || record === null || Array.isArray(record)) continue;
    const dependencyRecord = record as Record<string, string>;

    for (const packageName of CDS_PACKAGE_NAMES) {
      const current = dependencyRecord[packageName];
      if (!current) continue;

      before[`${section}.${packageName}`] = current;
      if (packageName === "@sap/cds" && !fromMajor) fromMajor = majorOf(current);

      const rangePrefix = current.match(/^[\^~]/)?.[0] ?? "";
      const nextValue = `${rangePrefix}${targetVersion}`;
      if (current !== nextValue) {
        dependencyRecord[packageName] = nextValue;
        changed = true;
      }
      after[`${section}.${packageName}`] = nextValue;
    }
  }

  const fixupContext: TCdsFixupContext = { packageJson, fromMajor, toMajor: majorOf(targetVersion) };
  const fixups = runKnownFixups(fixupContext);
  if (fixups.changed) changed = true;

  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  return { changed, before, after, fixups: fixups.results };
}

export type TNpmInstallResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean };

const DEFAULT_NPM_INSTALL_TIMEOUT_MS = 8 * 60_000;

/** No revert-on-finish (unlike `installRepository`) — the bumped `package.json` and the resulting `package-lock.json` must both survive to be committed. */
export async function runNpmInstall(repoPath: string, options?: { timeoutMs?: number; onLog?: (chunk: string) => void; onErrorLog?: (chunk: string) => void }): Promise<TNpmInstallResult> {
  const childProcess = execa("npm", ["install"], { cwd: repoPath, reject: false, all: false, timeout: options?.timeoutMs ?? DEFAULT_NPM_INSTALL_TIMEOUT_MS });

  let stdout = "";
  let stderr = "";
  childProcess.stdout?.on("data", (chunk: Buffer) => {
    const value = chunk.toString();
    stdout += value;
    options?.onLog?.(value);
  });
  childProcess.stderr?.on("data", (chunk: Buffer) => {
    const value = chunk.toString();
    stderr += value;
    options?.onErrorLog?.(value);
  });

  const result = await childProcess;
  return { exitCode: result.exitCode ?? 0, stdout, stderr, timedOut: result.timedOut ?? false };
}
