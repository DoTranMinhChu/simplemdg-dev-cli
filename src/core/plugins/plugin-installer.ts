import fs from "fs-extra";
import { findReverseDependents, resolveInstallOrder } from "./plugin-graph";
import { getPluginDir, loadPluginRegistry } from "./plugin-registry";
import { checkFileDrift, planContentFiles, writePlannedFile } from "./plugin-content";
import { addMcpServer, removeMcpServer } from "./plugin-mcp";
import { readPluginState, writePluginState } from "./plugin-state-store";
import type { TInstallPlan, TInstallScope, TInstalledPluginRecord, TPlanStep, TPluginManifest } from "./plugin-types";

type TContext = {
  registry: Map<string, TPluginManifest>;
  installedByScope: Record<TInstallScope, TInstalledPluginRecord[]>;
};

async function loadContext(projectRoot?: string): Promise<TContext> {
  const registry = await loadPluginRegistry();
  const userState = await readPluginState("user");
  const projectState = projectRoot ? await readPluginState("project", projectRoot) : { installed: [] };
  return {
    registry,
    installedByScope: { user: userState.installed, project: projectState.installed },
  };
}

function findInstalled(context: TContext, pluginId: string): { record: TInstalledPluginRecord; scope: TInstallScope } | undefined {
  for (const scope of ["user", "project"] as TInstallScope[]) {
    const record = context.installedByScope[scope].find((item) => item.pluginId === pluginId);
    if (record) return { record, scope };
  }
  return undefined;
}

function effectiveScopeFor(manifest: TPluginManifest, requestedScope: TInstallScope): TInstallScope {
  return manifest.mcpScope === "always-user" ? "user" : requestedScope;
}

/** Resolves the full dependency closure for the requested ids and builds a preview of what
 * installing them would do — already-satisfied plugins (installed at either scope, since Claude
 * Code merges scopes at runtime) are skipped; new ones list every file and MCP server they'd add,
 * plus whether any target file already exists with content we didn't write (drift). */
export async function buildInstallPlan(requestedIds: string[], scope: TInstallScope, projectRoot?: string): Promise<TInstallPlan> {
  const context = await loadContext(projectRoot);
  const order = resolveInstallOrder(context.registry, requestedIds);
  const steps: TPlanStep[] = [];

  for (const pluginId of order) {
    const manifest = context.registry.get(pluginId);
    if (!manifest) continue;

    const existing = findInstalled(context, pluginId);
    if (existing) {
      steps.push({ pluginId, manifest, alreadySatisfied: true, satisfiedAtScope: existing.scope, filesToWrite: [], mcpServersToRegister: [] });
      continue;
    }

    const effectiveScope = effectiveScopeFor(manifest, scope);
    const pluginDir = await getPluginDir(pluginId);
    const plannedFiles = await planContentFiles(pluginDir, manifest, effectiveScope, projectRoot);

    const filesToWrite = [];
    for (const planned of plannedFiles) {
      const drift = await checkFileDrift(planned.targetPath, undefined);
      filesToWrite.push({ targetPath: planned.targetPath, isNew: drift === "new", driftDetected: drift === "drifted" });
    }

    const mcpServersToRegister = (manifest.components.mcpServers ?? []).map((spec) => ({ name: spec.name, scope: effectiveScope }));

    steps.push({ pluginId, manifest, alreadySatisfied: false, filesToWrite, mcpServersToRegister });
  }

  return { requestedIds, order, steps };
}

type TCompletedStep = {
  pluginId: string;
  writtenFiles: Array<{ path: string; sha256: string }>;
  registeredMcpServers: Array<{ name: string; scope: TInstallScope }>;
};

async function rollback(completedSteps: TCompletedStep[]): Promise<void> {
  for (const step of [...completedSteps].reverse()) {
    for (const server of [...step.registeredMcpServers].reverse()) {
      await removeMcpServer(server.name, server.scope).catch(() => undefined);
    }
    for (const file of [...step.writtenFiles].reverse()) {
      await fs.remove(file.path).catch(() => undefined);
    }
  }
}

export type TInstallOptions = {
  force?: boolean;
};

/** Executes a previously built plan: files first (cheap, reversible), MCP registration second, in
 * dependency order. On any failure, everything this run created is rolled back (in reverse) and
 * the original error is rethrown. Install-state files are only written after every step succeeds —
 * a partial run never leaves a plugin recorded as installed. */
export async function executeInstallPlan(plan: TInstallPlan, scope: TInstallScope, projectRoot?: string, options: TInstallOptions = {}): Promise<TCompletedStep[]> {
  const completedSteps: TCompletedStep[] = [];
  const newRecordsByScope: Record<TInstallScope, TInstalledPluginRecord[]> = { user: [], project: [] };

  try {
    for (const step of plan.steps) {
      if (step.alreadySatisfied) continue;

      if (!options.force && step.filesToWrite.some((file) => file.driftDetected)) {
        throw new Error(`Refusing to overwrite hand-modified file(s) for "${step.pluginId}". Re-run with --force to overwrite, or remove the conflicting file(s) first.`);
      }

      const effectiveScope = effectiveScopeFor(step.manifest, scope);
      const pluginDir = await getPluginDir(step.pluginId);
      const plannedFiles = await planContentFiles(pluginDir, step.manifest, effectiveScope, projectRoot);

      const writtenFiles: Array<{ path: string; sha256: string }> = [];
      for (const planned of plannedFiles) {
        writtenFiles.push(await writePlannedFile(planned));
      }

      const registeredMcpServers: Array<{ name: string; scope: TInstallScope }> = [];
      for (const spec of step.manifest.components.mcpServers ?? []) {
        await addMcpServer(spec, effectiveScope);
        registeredMcpServers.push({ name: spec.name, scope: effectiveScope });
      }

      completedSteps.push({ pluginId: step.pluginId, writtenFiles, registeredMcpServers });
      newRecordsByScope[effectiveScope].push({
        pluginId: step.pluginId,
        version: step.manifest.version,
        scope: effectiveScope,
        installedAt: new Date().toISOString(),
        files: writtenFiles,
        mcpServers: registeredMcpServers,
      });
    }
  } catch (error) {
    await rollback(completedSteps);
    throw error;
  }

  for (const recordScope of ["user", "project"] as TInstallScope[]) {
    const newRecords = newRecordsByScope[recordScope];
    if (newRecords.length === 0) continue;

    const state = await readPluginState(recordScope, projectRoot);
    const newIds = new Set(newRecords.map((record) => record.pluginId));
    state.installed = [...state.installed.filter((record) => !newIds.has(record.pluginId)), ...newRecords];
    await writePluginState(recordScope, state, projectRoot);
  }

  return completedSteps;
}

export type TUpdateResult = {
  pluginId: string;
  scope: TInstallScope;
  fromVersion: string;
  toVersion: string;
  updatedFiles: string[];
  reregisteredMcpServers: string[];
};

/** Re-copies a plugin's current bundled content over its existing install and re-registers its MCP
 * servers (idempotent — `addMcpServer` removes-then-adds). Always updates at the scope the plugin
 * is already installed at, never the caller's requested scope. Refuses on hand-edited files unless
 * `force` is set, exactly like a fresh install would. */
export async function updateInstalledPlugin(pluginId: string, options: { force?: boolean; projectRoot?: string } = {}): Promise<TUpdateResult> {
  const context = await loadContext(options.projectRoot);
  const existing = findInstalled(context, pluginId);
  if (!existing) {
    throw new Error(`Plugin "${pluginId}" is not installed.`);
  }
  const manifest = context.registry.get(pluginId);
  if (!manifest) {
    throw new Error(`Plugin "${pluginId}" is installed but no longer present in the bundled registry.`);
  }

  const scope = existing.scope;
  const pluginDir = await getPluginDir(pluginId);
  const plannedFiles = await planContentFiles(pluginDir, manifest, scope, options.projectRoot);

  if (!options.force) {
    for (const planned of plannedFiles) {
      const recordedHash = existing.record.files.find((file) => file.path === planned.targetPath)?.sha256;
      const drift = await checkFileDrift(planned.targetPath, recordedHash);
      if (drift === "drifted") {
        throw new Error(`Refusing to overwrite hand-modified file "${planned.targetPath}". Re-run with --force to overwrite.`);
      }
    }
  }

  const updatedFiles: Array<{ path: string; sha256: string }> = [];
  for (const planned of plannedFiles) {
    updatedFiles.push(await writePlannedFile(planned));
  }

  const reregisteredMcpServers: Array<{ name: string; scope: TInstallScope }> = [];
  for (const spec of manifest.components.mcpServers ?? []) {
    await addMcpServer(spec, scope);
    reregisteredMcpServers.push({ name: spec.name, scope });
  }

  const state = await readPluginState(scope, options.projectRoot);
  state.installed = state.installed.map((record) =>
    record.pluginId === pluginId
      ? { ...record, version: manifest.version, installedAt: new Date().toISOString(), files: updatedFiles, mcpServers: reregisteredMcpServers }
      : record,
  );
  await writePluginState(scope, state, options.projectRoot);

  return {
    pluginId,
    scope,
    fromVersion: existing.record.version,
    toVersion: manifest.version,
    updatedFiles: updatedFiles.map((file) => file.path),
    reregisteredMcpServers: reregisteredMcpServers.map((server) => server.name),
  };
}

export type TUninstallBlocked = { blockedBy: string[] };
export type TUninstallResult = { removedPluginIds: string[]; removedFiles: string[]; removedMcpServers: string[] };

/** Refuses to remove a plugin that other installed plugins still transitively depend on, unless
 * `forceCascade` is set — in which case every dependent is removed too (never a silent cascade). */
export async function uninstallPlugin(pluginId: string, options: { forceCascade?: boolean; projectRoot?: string } = {}): Promise<TUninstallBlocked | TUninstallResult> {
  const context = await loadContext(options.projectRoot);
  const existing = findInstalled(context, pluginId);
  if (!existing) {
    throw new Error(`Plugin "${pluginId}" is not installed.`);
  }

  const allInstalledIds = [...context.installedByScope.user, ...context.installedByScope.project].map((record) => record.pluginId);
  const dependents = findReverseDependents(context.registry, allInstalledIds, pluginId);

  if (dependents.length > 0 && !options.forceCascade) {
    return { blockedBy: dependents };
  }

  const idsToRemove = options.forceCascade ? [pluginId, ...dependents] : [pluginId];
  const removedFiles: string[] = [];
  const removedMcpServers: string[] = [];

  for (const id of idsToRemove) {
    const target = findInstalled(context, id);
    if (!target) continue;

    for (const file of target.record.files) {
      await fs.remove(file.path).catch(() => undefined);
      removedFiles.push(file.path);
    }
    for (const server of target.record.mcpServers) {
      await removeMcpServer(server.name, server.scope).catch(() => undefined);
      removedMcpServers.push(server.name);
    }

    const state = await readPluginState(target.scope, options.projectRoot);
    state.installed = state.installed.filter((record) => record.pluginId !== id);
    await writePluginState(target.scope, state, options.projectRoot);
  }

  return { removedPluginIds: idsToRemove, removedFiles, removedMcpServers };
}
