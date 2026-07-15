import fs from "fs-extra";
import { listMcpServers } from "./plugin-mcp";
import { loadPluginRegistry } from "./plugin-registry";
import { hashFileContent, readAllInstalled } from "./plugin-state-store";
import type { TInstallScope } from "./plugin-types";

export type TPluginDoctorIssueKind = "missing-from-registry" | "file-drifted" | "file-missing" | "mcp-server-missing" | "missing-dependency" | "update-available";

export type TPluginDoctorIssue = {
  pluginId: string;
  scope: TInstallScope;
  kind: TPluginDoctorIssueKind;
  detail: string;
};

export type TPluginDoctorReport = {
  installedCount: number;
  issues: TPluginDoctorIssue[];
};

export async function runPluginDoctor(projectRoot?: string): Promise<TPluginDoctorReport> {
  const registry = await loadPluginRegistry();
  const installed = await readAllInstalled(projectRoot);
  const installedIds = new Set(installed.map((record) => record.pluginId));
  const mcpListOutput = await listMcpServers().catch(() => "");
  const issues: TPluginDoctorIssue[] = [];

  for (const record of installed) {
    const manifest = registry.get(record.pluginId);
    if (!manifest) {
      issues.push({
        pluginId: record.pluginId,
        scope: record.scope,
        kind: "missing-from-registry",
        detail: "Installed but no longer present in the bundled registry (renamed or removed in a newer CLI version?).",
      });
      continue;
    }

    if (manifest.version !== record.version) {
      issues.push({
        pluginId: record.pluginId,
        scope: record.scope,
        kind: "update-available",
        detail: `Installed v${record.version}, registry has v${manifest.version}. Run "smdg plugin update ${record.pluginId}" to sync.`,
      });
    }

    // Backstops the reverse-dependents guard in `uninstallPlugin`, which can only see
    // dependents in the *current* project — a dependency removed while standing in a
    // different project (or with no --cwd) is exactly the case this catches after the fact.
    for (const dependencyId of manifest.dependsOn) {
      if (!installedIds.has(dependencyId)) {
        issues.push({
          pluginId: record.pluginId,
          scope: record.scope,
          kind: "missing-dependency",
          detail: `Requires "${dependencyId}", which is not installed (removed elsewhere?). Run "smdg plugin add ${dependencyId}" to restore it.`,
        });
      }
    }

    for (const file of record.files) {
      if (!(await fs.pathExists(file.path))) {
        issues.push({ pluginId: record.pluginId, scope: record.scope, kind: "file-missing", detail: file.path });
        continue;
      }
      const currentHash = hashFileContent(await fs.readFile(file.path));
      if (currentHash !== file.sha256) {
        issues.push({ pluginId: record.pluginId, scope: record.scope, kind: "file-drifted", detail: file.path });
      }
    }

    for (const server of record.mcpServers) {
      if (!mcpListOutput.includes(server.name)) {
        issues.push({ pluginId: record.pluginId, scope: record.scope, kind: "mcp-server-missing", detail: server.name });
      }
    }
  }

  return { installedCount: installed.length, issues };
}
