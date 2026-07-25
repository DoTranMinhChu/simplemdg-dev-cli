import path from "node:path";
import fs from "fs-extra";
import { execa } from "execa";
import { replaceVariables } from "../install";
import { runKnownFixups } from "./cds-upgrade-fixups";
import type { TCdsFixupContext, TCdsFixupResult } from "./cds-upgrade-fixups";

/**
 * `installRepository()` (`src/core/install.ts`) can't be reused here — it
 * unconditionally reverts every touched file (including `package.json`) in a
 * `finally` block since it's designed for ephemeral variable substitution,
 * targets an `overrides` block rather than a real dependency bump, and has
 * no timeout. This is a durable bump: the written `package.json` must
 * survive so it can be committed. It DOES reuse `replaceVariables` (the same
 * `${VAR}` substitution `smdg install` already does) — real master-data
 * repos pin sibling packages via placeholders like
 * `"@simplemdg/db_common": "${SIMPLEMDG_BRANCH}"`, and `npm install` chokes
 * on the literal, unsubstituted string otherwise (confirmed: a real run hit
 * exactly this, `npm error code EINVALIDTAGNAME`).
 */

const CDS_PACKAGE_NAMES = ["@sap/cds", "@sap/cds-dk", "@sap/cds-compiler"] as const;
const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies", "overrides"] as const;
const VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
// Confirmed with the user: every `${..._BRANCH}`-named placeholder in these repos means
// "the branch this dependency should point at" — i.e. the same branch being upgraded.
// Anything else has no known mapping and must be reported, not guessed.
const BRANCH_VARIABLE_RE = /_BRANCH$/i;

export type TCdsBumpResult = {
  changed: boolean;
  /** `"<section>.<packageName>"` -> version string, before and after. */
  before: Record<string, string>;
  after: Record<string, string>;
  fixups: TCdsFixupResult[];
  substitutedVariables: string[];
  /** Unique `@scope` prefixes found among this repo's own dependency names, after substitution — used to decide whether a private-registry `.npmrc` is needed before `npm install`. */
  scopePrefixes: string[];
};

function majorOf(versionRange: string | undefined): number {
  return Number(versionRange?.match(/(\d+)/)?.[1] ?? 0);
}

function findVariableNames(content: string): string[] {
  const names = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_PATTERN.exec(content)) !== null) names.add(match[1]);
  return Array.from(names);
}

// `@sap/*` (cds, cds-dk, cds-compiler, and other SAP-published tooling) lives on the public npm
// registry — it's already been bumped by name above and never needs private-registry auth. Only
// OTHER scopes (e.g. `@simplemdg/*`) indicate a private package registry npmrc is needed.
const PUBLIC_SCOPES = new Set(["@sap"]);

function collectScopePrefixes(packageJson: Record<string, unknown>): string[] {
  const scopes = new Set<string>();
  for (const section of DEPENDENCY_SECTIONS) {
    const record = packageJson[section];
    if (typeof record !== "object" || record === null || Array.isArray(record)) continue;
    for (const name of Object.keys(record as Record<string, unknown>)) {
      if (name.startsWith("@")) {
        const scope = name.split("/")[0];
        if (!PUBLIC_SCOPES.has(scope)) scopes.add(scope);
      }
    }
  }
  return Array.from(scopes);
}

/**
 * Rewrites every `@sap/cds`/`@sap/cds-dk`/`@sap/cds-compiler` entry found in `dependencies`/
 * `devDependencies`/`overrides` to `targetVersion`, preserving each entry's existing range prefix
 * (`^`/`~`/exact); first substitutes any `${..._BRANCH}` placeholder with `sourceBranch` (throws,
 * naming the exact placeholder, if any OTHER `${VARIABLE}` has no known mapping — no blind
 * guessing); then applies the known-fixups ruleset against the same in-memory object before one
 * write-back.
 */
export async function bumpCdsPackageJson(repoPath: string, targetVersion: string, sourceBranch: string): Promise<TCdsBumpResult> {
  const packageJsonPath = path.join(repoPath, "package.json");
  const rawContent = await fs.readFile(packageJsonPath, "utf8");

  const variableNames = findVariableNames(rawContent);
  const substitutedVariables = variableNames.filter((name) => BRANCH_VARIABLE_RE.test(name));
  const unresolvedVariables = variableNames.filter((name) => !BRANCH_VARIABLE_RE.test(name));
  if (unresolvedVariables.length > 0) {
    throw new Error(`Missing value(s) for ${unresolvedVariables.map((name) => `\${${name}}`).join(", ")} in package.json — no known mapping for these placeholder(s).`);
  }

  const variableValues = Object.fromEntries(substitutedVariables.map((name) => [name, sourceBranch]));
  const substitutedContent = replaceVariables(rawContent, variableValues);
  const packageJson = JSON.parse(substitutedContent) as Record<string, unknown>;

  const before: Record<string, string> = {};
  const after: Record<string, string> = {};
  let changed = substitutedVariables.length > 0;
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

  return { changed, before, after, fixups: fixups.results, substitutedVariables, scopePrefixes: collectScopePrefixes(packageJson) };
}

export type TNpmInstallResult = { exitCode: number; stdout: string; stderr: string; timedOut: boolean };

const DEFAULT_NPM_INSTALL_TIMEOUT_MS = 8 * 60_000;

/**
 * No revert-on-finish (unlike `installRepository`) — the bumped `package.json` and the resulting
 * `package-lock.json` must both survive to be committed. `npmrcPath`, when given, points npm at a
 * config file OUTSIDE the repo (via `NPM_CONFIG_USERCONFIG`) rather than writing a `.npmrc` inside
 * the clone — the auth token it carries must never end up inside `git add -A`'s reach (a `.npmrc`
 * physically in the repo would risk leaking the token into the pushed branch/MR).
 */
export async function runNpmInstall(repoPath: string, options?: { timeoutMs?: number; npmrcPath?: string; onLog?: (chunk: string) => void; onErrorLog?: (chunk: string) => void }): Promise<TNpmInstallResult> {
  const childProcess = execa("npm", ["install"], {
    cwd: repoPath,
    reject: false,
    all: false,
    timeout: options?.timeoutMs ?? DEFAULT_NPM_INSTALL_TIMEOUT_MS,
    env: options?.npmrcPath ? { NPM_CONFIG_USERCONFIG: options.npmrcPath } : undefined,
  });

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
