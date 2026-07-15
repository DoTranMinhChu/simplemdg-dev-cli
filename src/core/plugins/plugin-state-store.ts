import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import type { TInstallScope, TInstalledPluginRecord, TPluginStateFile } from "./plugin-types";

export function userPluginsStateDir(): string {
  return path.join(os.homedir(), ".simplemdg", "plugins");
}

function userStateFilePath(): string {
  return path.join(userPluginsStateDir(), "installed.json");
}

/** Project-scope bookkeeping lives beside `.claude/`, not inside it, so this tool's own state
 * never collides with anything Claude Code itself reads or writes under `.claude/`. */
function projectStateFilePath(projectRoot: string): string {
  return path.join(projectRoot, ".simplemdg", "plugins.lock.json");
}

function stateFilePath(scope: TInstallScope, projectRoot?: string): string {
  if (scope === "user") return userStateFilePath();
  if (!projectRoot) throw new Error("projectRoot is required to read/write project-scope plugin state.");
  return projectStateFilePath(projectRoot);
}

export async function readPluginState(scope: TInstallScope, projectRoot?: string): Promise<TPluginStateFile> {
  const filePath = stateFilePath(scope, projectRoot);

  if (!(await fs.pathExists(filePath))) {
    return { installed: [] };
  }

  try {
    const raw = await fs.readJson(filePath);
    if (raw && Array.isArray(raw.installed)) {
      return raw as TPluginStateFile;
    }
    return { installed: [] };
  } catch {
    return { installed: [] };
  }
}

export async function writePluginState(scope: TInstallScope, state: TPluginStateFile, projectRoot?: string): Promise<void> {
  const filePath = stateFilePath(scope, projectRoot);
  await fs.ensureDir(path.dirname(filePath));

  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
}

export type TInstalledPluginRecordWithScope = TInstalledPluginRecord & { scope: TInstallScope };

/** Reads installed-plugin records across both scopes — dependency-satisfaction and
 * reverse-dependent checks must never look at just one scope, since Claude Code merges
 * user + project configuration at runtime. */
export async function readAllInstalled(projectRoot?: string): Promise<TInstalledPluginRecordWithScope[]> {
  const userState = await readPluginState("user");
  const projectState = projectRoot ? await readPluginState("project", projectRoot) : { installed: [] };

  return [
    ...userState.installed.map((record) => ({ ...record, scope: "user" as const })),
    ...projectState.installed.map((record) => ({ ...record, scope: "project" as const })),
  ];
}

export function hashFileContent(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}
