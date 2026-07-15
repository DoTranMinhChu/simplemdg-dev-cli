import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { TInstallScope, TPluginManifest } from "./plugin-types";
import { hashFileContent } from "./plugin-state-store";

export function claudeRootDir(scope: TInstallScope, projectRoot?: string): string {
  if (scope === "user") return path.join(os.homedir(), ".claude");
  if (!projectRoot) throw new Error("projectRoot is required for project-scope installs.");
  return path.join(projectRoot, ".claude");
}

export type TPlannedFile = {
  sourcePath: string;
  targetPath: string;
};

/** Maps a plugin's declared content onto concrete install targets. Agent files always land at
 * `.claude/agents/<pluginId>.md` (the plugin id, not the source filename, so it matches the
 * subagent's own `name:` frontmatter); skill files land under `.claude/skills/<pluginId>/`. */
export async function planContentFiles(pluginDir: string, manifest: TPluginManifest, scope: TInstallScope, projectRoot?: string): Promise<TPlannedFile[]> {
  const claudeRoot = claudeRootDir(scope, projectRoot);
  const planned: TPlannedFile[] = [];

  for (const relativeAgentFile of manifest.components.agentFiles ?? []) {
    planned.push({
      sourcePath: path.join(pluginDir, relativeAgentFile),
      targetPath: path.join(claudeRoot, "agents", `${manifest.id}.md`),
    });
  }

  if (manifest.components.skillDir) {
    const sourceSkillDir = path.join(pluginDir, manifest.components.skillDir);
    const targetSkillDir = path.join(claudeRoot, "skills", manifest.id);
    const entries = await fs.readdir(sourceSkillDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      planned.push({
        sourcePath: path.join(sourceSkillDir, entry.name),
        targetPath: path.join(targetSkillDir, entry.name),
      });
    }
  }

  return planned;
}

export type TFileDriftStatus = "new" | "unchanged" | "drifted";

/** Compares what's currently on disk against the hash recorded at install time. `"drifted"`
 * covers both "hand-edited after install" and "exists with no provenance record at all" — either
 * way, this file must never be silently overwritten. */
export async function checkFileDrift(targetPath: string, recordedHash: string | undefined): Promise<TFileDriftStatus> {
  if (!(await fs.pathExists(targetPath))) return "new";
  if (!recordedHash) return "drifted";
  const currentHash = hashFileContent(await fs.readFile(targetPath));
  return currentHash === recordedHash ? "unchanged" : "drifted";
}

export async function writePlannedFile(planned: TPlannedFile): Promise<{ path: string; sha256: string }> {
  await fs.ensureDir(path.dirname(planned.targetPath));
  const content = await fs.readFile(planned.sourcePath);
  await fs.writeFile(planned.targetPath, content);
  return { path: planned.targetPath, sha256: hashFileContent(content) };
}
