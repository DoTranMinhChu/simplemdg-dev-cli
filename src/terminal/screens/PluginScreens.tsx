import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import { ConfirmationPanel } from "../components/ConfirmationPanel";
import { formatManifestLine } from "../../commands/plugin.command";
import { runPluginDoctor } from "../../core/plugins/plugin-doctor";
import { PluginCycleError, PluginNotFoundError } from "../../core/plugins/plugin-graph";
import { buildInstallPlan, executeInstallPlan, uninstallPlugin, updateInstalledPlugin } from "../../core/plugins/plugin-installer";
import { getPluginUsage, loadPluginRegistry } from "../../core/plugins/plugin-registry";
import { readAllInstalled } from "../../core/plugins/plugin-state-store";
import { resolveRepositoryPath } from "../../core/repository";
import type { TInstallPlan, TInstallScope, TPluginManifest } from "../../core/plugins/plugin-types";
import type { InkInteractionService } from "../services/ink-interaction-service";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };

async function resolveProjectRoot(): Promise<string | undefined> {
  return resolveRepositoryPath(process.cwd()).catch(() => undefined);
}

export function PluginListScreen(props: TScreenProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const registry = await loadPluginRegistry();
      const projectRoot = await resolveProjectRoot();
      const installed = await readAllInstalled(projectRoot);
      const installedById = new Map(installed.map((record) => [record.pluginId, record]));

      if (registry.size === 0) {
        props.service.notify({ level: "muted", message: "No plugins found in the bundled registry." });
        props.onDone(true);
        return;
      }

      props.service.notify({ level: "step", message: "Available plugins" });
      for (const manifest of registry.values()) {
        const record = installedById.get(manifest.id);
        props.service.notify({ level: "muted", message: formatManifestLine(manifest, record ? `installed, ${record.scope}` : undefined) });
        if (manifest.dependsOn.length > 0) {
          props.service.notify({ level: "muted", message: `  depends on: ${manifest.dependsOn.join(", ")}` });
        }
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function PluginInfoScreen(props: TScreenProps) {
  const [registry, setRegistry] = useState<Map<string, TPluginManifest> | undefined>(undefined);
  const [manifest, setManifest] = useState<TPluginManifest | undefined>(undefined);
  const reportedRef = useRef(false);

  useEffect(() => {
    void loadPluginRegistry().then(setRegistry);
  }, []);

  useEffect(() => {
    if (!manifest || reportedRef.current) return;
    reportedRef.current = true;

    void (async () => {
      const notify = (message: string) => props.service.notify({ level: "muted", message });
      notify(`${manifest.displayName} (${manifest.id}) — v${manifest.version}, ${manifest.kind}`);
      notify(manifest.description);
      notify(`Depends on: ${manifest.dependsOn.length ? manifest.dependsOn.join(", ") : "(none)"}`);
      if (manifest.components.agentFiles?.length) notify(`Agents: ${manifest.components.agentFiles.length}`);
      if (manifest.components.skillDir) notify(`Skill: ${manifest.id}`);
      if (manifest.components.mcpServers?.length) notify(`MCP servers: ${manifest.components.mcpServers.map((server) => server.name).join(", ")}`);
      if (manifest.studioExtension) notify(`AI Studio panel: ${manifest.studioExtension.label}`);

      const usage = await getPluginUsage(manifest.id);
      if (usage) {
        props.service.notify({ level: "step", message: "Usage" });
        notify(usage.trim());
      }
      props.onDone(true);
    })();
  }, [manifest]);

  if (!manifest) {
    if (!registry) return <Text dimColor>Loading plugin registry…</Text>;
    return (
      <SearchableList
        message="Select plugin"
        choices={[...registry.values()].map((entry) => ({ title: `${entry.displayName} (${entry.id})`, value: entry.id, description: entry.description }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={(value) => setManifest(registry.get(value))}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function PluginDoctorScreen(props: TScreenProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      // Scanning project-scoped plugin state against the registry can take a
      // while on a large repo — say so up front rather than leaving the
      // screen looking stuck on "Working…" with no feedback.
      props.service.notify({ level: "muted", message: "Scanning installed plugins for drift/updates…" });
      const projectRoot = await resolveProjectRoot();
      const report = await runPluginDoctor(projectRoot);

      props.service.notify({ level: "step", message: `Plugin doctor — ${report.installedCount} installed` });
      if (report.issues.length === 0) {
        props.service.notify({ level: "success", message: "No issues found." });
      } else {
        for (const issue of report.issues) {
          props.service.notify({ level: "warn", message: `[${issue.scope}] ${issue.pluginId} — ${issue.kind}: ${issue.detail}` });
        }
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

type TAddStep = "pick-plugin" | "pick-scope" | "confirming" | "installing";

export function PluginAddScreen(props: TScreenProps) {
  const [registry, setRegistry] = useState<Map<string, TPluginManifest> | undefined>(undefined);
  const [pluginId, setPluginId] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<TInstallScope | undefined>(undefined);
  const [plan, setPlan] = useState<TInstallPlan | undefined>(undefined);
  const planStartedRef = useRef(false);
  const installStartedRef = useRef(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    void loadPluginRegistry().then(setRegistry);
  }, []);

  useEffect(() => {
    if (!pluginId || !scope || planStartedRef.current) return;
    planStartedRef.current = true;

    void (async () => {
      const projectRoot = scope === "project" ? await resolveRepositoryPath(process.cwd()) : await resolveProjectRoot();

      try {
        const nextPlan = await buildInstallPlan([pluginId], scope, projectRoot);
        for (const step of nextPlan.steps) {
          if (step.alreadySatisfied) {
            props.service.notify({ level: "muted", message: `${step.pluginId} — already installed (${step.satisfiedAtScope} scope), skipping` });
          } else {
            props.service.notify({ level: "muted", message: `+ ${step.pluginId} (${step.manifest.version})` });
            for (const file of step.filesToWrite) {
              props.service.notify({ level: "muted", message: `    file  ${file.targetPath} ${file.driftDetected ? "[hand-modified, needs --force]" : file.isNew ? "[new]" : "[overwrite]"}` });
            }
          }
        }
        setPlan(nextPlan);
      } catch (error) {
        const message =
          error instanceof PluginCycleError
            ? `Cannot install: ${error.message}`
            : error instanceof PluginNotFoundError
              ? `Unknown plugin id: ${error.pluginId}`
              : error instanceof Error
                ? error.message
                : String(error);
        props.service.notify({ level: "error", message });
        props.onDone(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, scope]);

  useEffect(() => {
    if (!plan || !confirmed || !scope || installStartedRef.current) return;
    installStartedRef.current = true;

    void (async () => {
      const pendingSteps = plan.steps.filter((step) => !step.alreadySatisfied);
      const projectRoot = scope === "project" ? await resolveRepositoryPath(process.cwd()) : await resolveProjectRoot();

      try {
        await executeInstallPlan(plan, scope, projectRoot);
        props.service.notify({ level: "success", message: `Installed ${pendingSteps.length} plugin(s).` });
        for (const step of pendingSteps) {
          const usage = await getPluginUsage(step.pluginId);
          if (usage) props.service.notify({ level: "muted", message: `── ${step.pluginId} usage ──\n${usage.trim()}` });
        }
        props.onDone(true);
      } catch (error) {
        props.service.notify({ level: "error", message: `Install failed, rolled back: ${error instanceof Error ? error.message : String(error)}` });
        props.onDone(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, confirmed]);

  if (!pluginId) {
    if (!registry) return <Text dimColor>Loading plugin registry…</Text>;
    return (
      <SearchableList
        message="Plugin to install"
        choices={[...registry.values()].map((entry) => ({ title: `${entry.displayName} (${entry.id})`, value: entry.id, description: entry.description }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={setPluginId}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (!scope) {
    return (
      <SearchableList
        message="Install scope"
        choices={[
          { title: "User (available in every project on this machine)", value: "user" },
          { title: "Project (this repo only, under ./.claude — shareable via git)", value: "project" },
        ]}
        onSubmit={(value) => setScope(value as TInstallScope)}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (plan && !confirmed) {
    const pendingCount = plan.steps.filter((step) => !step.alreadySatisfied).length;
    if (pendingCount === 0) {
      return <Text color="yellow">Nothing to do — everything requested is already installed. Press Enter to dismiss.</Text>;
    }
    return (
      <ConfirmationPanel
        message={`Proceed with installing ${pendingCount} plugin(s) at ${scope} scope?`}
        initial={true}
        onSubmit={(value) => (value ? setConfirmed(true) : props.onDone(false))}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function PluginRemoveScreen(props: TScreenProps) {
  const [installed, setInstalled] = useState<{ pluginId: string; scope: string }[] | undefined>(undefined);
  const [pluginId, setPluginId] = useState<string | undefined>(undefined);
  const [blockedBy, setBlockedBy] = useState<string[] | undefined>(undefined);
  const [confirmedCascade, setConfirmedCascade] = useState(false);
  const startedRef = useRef(false);
  const cascadeStartedRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const projectRoot = await resolveProjectRoot();
      setInstalled(await readAllInstalled(projectRoot));
    })();
  }, []);

  useEffect(() => {
    if (!pluginId || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const projectRoot = await resolveProjectRoot();
      try {
        const result = await uninstallPlugin(pluginId, { projectRoot });
        if ("blockedBy" in result) {
          props.service.notify({ level: "warn", message: `Cannot remove "${pluginId}" — other installed plugins still depend on it: ${result.blockedBy.join(", ")}` });
          setBlockedBy(result.blockedBy);
          return;
        }
        props.service.notify({ level: "success", message: `Removed: ${result.removedPluginIds.join(", ")}` });
        props.onDone(true);
      } catch (error) {
        props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
        props.onDone(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId]);

  useEffect(() => {
    if (!pluginId || !confirmedCascade || cascadeStartedRef.current) return;
    cascadeStartedRef.current = true;

    void (async () => {
      const projectRoot = await resolveProjectRoot();
      const result = await uninstallPlugin(pluginId, { projectRoot, forceCascade: true });
      if ("blockedBy" in result) {
        props.service.notify({ level: "error", message: "Unexpected: still blocked after cascade." });
        props.onDone(false);
        return;
      }
      props.service.notify({ level: "success", message: `Removed: ${result.removedPluginIds.join(", ")}` });
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pluginId, confirmedCascade]);

  if (!pluginId) {
    if (!installed) return <Text dimColor>Loading installed plugins…</Text>;
    if (installed.length === 0) return <Text color="yellow">Nothing installed to remove. Press Enter to dismiss.</Text>;
    return (
      <SearchableList
        message="Plugin to remove"
        choices={installed.map((record) => ({ title: `${record.pluginId} (${record.scope})`, value: record.pluginId }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={setPluginId}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (blockedBy && !confirmedCascade) {
    return (
      <ConfirmationPanel
        message={`Also remove ${blockedBy.join(", ")} along with ${pluginId}?`}
        initial={false}
        onSubmit={(value) => (value ? setConfirmedCascade(true) : props.onDone(false))}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function PluginUpdateScreen(props: TScreenProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const projectRoot = await resolveProjectRoot();
      const installed = await readAllInstalled(projectRoot);

      if (installed.length === 0) {
        props.service.notify({ level: "muted", message: "Nothing installed to update." });
        props.onDone(true);
        return;
      }

      let hadError = false;
      for (const record of installed) {
        try {
          const result = await updateInstalledPlugin(record.pluginId, { projectRoot });
          const versionNote = result.fromVersion === result.toVersion ? `v${result.toVersion} (reinstalled)` : `${result.fromVersion} -> ${result.toVersion}`;
          props.service.notify({ level: "success", message: `Updated ${result.pluginId} ${versionNote}` });
        } catch (error) {
          hadError = true;
          props.service.notify({ level: "error", message: `${record.pluginId}: ${error instanceof Error ? error.message : String(error)}` });
        }
      }
      props.onDone(!hadError);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}
