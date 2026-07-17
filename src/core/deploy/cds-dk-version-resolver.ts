import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { execa } from "execa";
import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { fetchRawFile } from "../gitlab/gitlab-client";
import type { TCsnContent } from "./csn-model-types";

/**
 * `cds import` used to be invoked via whatever `@sap/cds-dk` happened to be on the PATH of the
 * machine running the tool — confirmed against a real deploy this caused a genuine (not cosmetic)
 * regression: `@sap/cds-dk@9.9.2` silently drops the `on` condition for compositions whose EDMX
 * association HAS a `<ReferentialConstraint>` (emitting `{ keys: [] }` instead), where the version
 * that generated every already-committed `srv/external/*.csn` (`7.9.10`, tagged in the file's own
 * `meta.creator`) correctly derives it (tagged `@cds.ambiguous`, but present and correct). Every
 * re-deploy with a different globally-installed cds-dk quietly rewrote that file with a different
 * shape — not just a different `meta.creator` string — with no signal to the user besides an
 * oversized, unreviewable diff.
 *
 * Fix: never rely on PATH. For an object type with a prior deploy, detect the exact version that
 * produced its last `srv|db/external/<entityName>.csn` (`meta.creator`) and reuse it — perfect
 * parity with everything already committed. For a first-ever deploy (nothing to detect from), fall
 * back to `DEFAULT_CDS_DK_VERSION`. Either way the resolved version is installed once into a
 * persistent per-version cache (`~/.smdg/cds-dk-cache/<version>`) and invoked by its own script path
 * — never the ambient `cds` on PATH.
 */
export const DEFAULT_CDS_DK_VERSION = "9.9.2";

const CDS_DK_CACHE_ROOT = path.join(os.homedir(), ".smdg", "cds-dk-cache");
const CREATOR_VERSION_RE = /cds-dk\s+([\d.]+)/i;

/** Fetches and parses the object type's previously-archived CSN (if any) — the single source of truth both for detecting its pinned cds-dk version and for detecting entity-identity risks (see `detectRenamedEntityLabels` in `csn-model-builder.ts`) against the freshly-imported one. */
export async function fetchArchivedCsn(auth: TGitLabAuth, projectId: number, branch: string, archiveFilePath: string): Promise<TCsnContent | undefined> {
  const raw = await fetchRawFile(auth, projectId, archiveFilePath, branch).catch(() => undefined);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as TCsnContent;
  } catch {
    return undefined;
  }
}

function extractCdsDkVersion(csn: TCsnContent | undefined): string | undefined {
  const creator = (csn as { meta?: { creator?: string } } | undefined)?.meta?.creator ?? "";
  return CREATOR_VERSION_RE.exec(creator)?.[1];
}

function cdsCliPathFor(versionDir: string): string {
  return path.join(versionDir, "node_modules", "@sap", "cds-dk", "bin", "cds.js");
}

// Guards against two concurrent deploys both missing the cache and racing the same `npm install`.
const inFlightInstalls = new Map<string, Promise<string>>();

/** Resolves to the absolute path of that exact version's `cds` CLI entry script, installing it into the persistent cache on first use (later calls for the same version are instant). */
export async function ensureCdsDkInstalled(version: string): Promise<string> {
  const versionDir = path.join(CDS_DK_CACHE_ROOT, version);
  const cliPath = cdsCliPathFor(versionDir);
  if (await fs.pathExists(cliPath)) return cliPath;

  const existing = inFlightInstalls.get(version);
  if (existing) return existing;

  const installPromise = (async () => {
    await fs.ensureDir(versionDir);
    await fs.writeJson(path.join(versionDir, "package.json"), { name: "smdg-cds-dk-cache", private: true });
    const result = await execa("npm", ["install", `@sap/cds-dk@${version}`, "--no-save", "--no-audit", "--no-fund"], { cwd: versionDir, reject: false });
    if (result.exitCode !== 0 || !(await fs.pathExists(cliPath))) {
      throw new Error(`Failed to install @sap/cds-dk@${version} into the version cache: ${result.stderr || result.stdout || "unknown npm error"}`);
    }
    return cliPath;
  })();

  inFlightInstalls.set(version, installPromise);
  try {
    return await installPromise;
  } finally {
    inFlightInstalls.delete(version);
  }
}

/** Convenience: detect (or fall back to the default) and ensure it's installed, in one call — returns the version, its resolved CLI path, and the parsed previous CSN itself (so callers don't have to re-fetch it for other before/after comparisons, e.g. entity-rename detection). */
export async function resolveCdsDkCli(auth: TGitLabAuth, projectId: number, branch: string, archiveFilePath: string): Promise<{ version: string; source: "detected" | "default"; cliPath: string; previousCsn: TCsnContent | undefined }> {
  const previousCsn = await fetchArchivedCsn(auth, projectId, branch, archiveFilePath);
  const detected = extractCdsDkVersion(previousCsn);
  const version = detected ?? DEFAULT_CDS_DK_VERSION;
  const cliPath = await ensureCdsDkInstalled(version);
  return { version, source: detected ? "detected" : "default", cliPath, previousCsn };
}
