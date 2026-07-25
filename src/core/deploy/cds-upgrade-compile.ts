import path from "node:path";
import fs from "fs-extra";
import fastGlob from "fast-glob";
import { execa } from "execa";
import type { TObjectTypeRepoRole } from "./object-type-discovery";

const DEFAULT_CDS_COMPILE_TIMEOUT_MS = 3 * 60_000;

/** Same path convention as `cds-dk-version-resolver.ts`'s `cdsCliPathFor` — the just-installed local `@sap/cds-dk`, never a global PATH binary, so validation reflects the exact freshly-bumped dependency tree. */
export async function resolveLocalCdsCli(repoPath: string): Promise<string | undefined> {
  const cliPath = path.join(repoPath, "node_modules", "@sap", "cds-dk", "bin", "cds.js");
  return (await fs.pathExists(cliPath)) ? cliPath : undefined;
}

/**
 * Some repos (e.g. the special `simplemdg_db_f4` — confirmed in
 * `object-type-discovery.ts`'s own comments to contain only
 * `db/external/*.csn`/`.xml` archive files, no real `.cds` schema) have
 * nothing to compile for their role at all. Rather than hardcoding that one
 * repo name, this checks structurally: does `db/` (or `srv/`) contain any
 * real `.cds` file outside its `external/` archive folder? If not, `cds
 * compile` was never going to succeed there regardless of the version
 * upgrade, so the job skips validation for that repo instead of reporting a
 * false "build failed".
 */
export async function hasCompilableModel(repoPath: string, role: TObjectTypeRepoRole): Promise<boolean> {
  const modelDir = role === "db" ? "db" : "srv";
  const matches = await fastGlob([`${modelDir}/**/*.cds`], { cwd: repoPath, ignore: [`${modelDir}/external/**`] });
  return matches.length > 0;
}

export type TCdsCompileResult = { ok: boolean; exitCode: number; stdout: string; stderr: string; timedOut: boolean };

/** Invokes the freshly-installed local `cds` CLI directly via `process.execPath` (mirrors `runEdmxImport`'s and `cds-dk-version-resolver.ts`'s existing convention) — never shells out to a bare `cds` on PATH. */
export async function runCdsCompileValidation(repoPath: string, role: TObjectTypeRepoRole, timeoutMs = DEFAULT_CDS_COMPILE_TIMEOUT_MS): Promise<TCdsCompileResult> {
  const cliPath = await resolveLocalCdsCli(repoPath);
  if (!cliPath) {
    return { ok: false, exitCode: -1, stdout: "", stderr: "node_modules/@sap/cds-dk/bin/cds.js not found after npm install — @sap/cds-dk may be missing from this repo's dependencies.", timedOut: false };
  }

  const model = role === "db" ? "db" : "srv";
  const result = await execa(process.execPath, [cliPath, "compile", model], { cwd: repoPath, reject: false, timeout: timeoutMs });
  const exitCode = result.exitCode ?? 0;
  return { ok: exitCode === 0, exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut ?? false };
}
