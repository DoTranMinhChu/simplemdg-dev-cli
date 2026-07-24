import React, { useEffect, useRef, useState } from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import { TextInputPrompt } from "../components/TextInputPrompt";
import {
  loadResolvedProxyEnvironments,
  resolveProxyConfigPath,
  resolveProxyUserCredential,
  exportProxyConfig,
  importProxyConfig,
} from "../../core/proxy/proxy-config-store";
import { isProxyEnvironmentRunning, getRunningProxyPorts, stopProxyEnvironment } from "../../core/proxy/proxy-runtime";
import { openLoggedInBrowserWindow } from "../../core/proxy/proxy-auth-browser";
import { isPortAvailable } from "../../core/studio-shared/studio-server-kit";
import { killProcessUsingPort } from "../../core/proxy/proxy-port-registry";
import type { TResolvedProxyEnvironment, TProxyConfigFile } from "../../core/proxy/proxy-types";
import type { InkInteractionService } from "../services/ink-interaction-service";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };

function useEnvironmentPicker(props: { service: InkInteractionService; onDone: (success: boolean) => void }): {
  env: TResolvedProxyEnvironment | undefined;
  choices: { title: string; value: string }[] | undefined;
  pick: (id: string) => void;
} {
  const [environments, setEnvironments] = useState<TResolvedProxyEnvironment[] | undefined>(undefined);
  const [env, setEnv] = useState<TResolvedProxyEnvironment | undefined>(undefined);

  useEffect(() => {
    const list = loadResolvedProxyEnvironments(resolveProxyConfigPath());
    if (list.length === 0) {
      props.service.notify({ level: "warn", message: 'No environments configured yet. Run "proxy add" first.' });
      props.onDone(false);
      return;
    }
    setEnvironments(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    env,
    choices: environments?.map((entry) => ({ title: entry.displayName, value: entry.id, description: entry.url })),
    pick: (id: string) => setEnv(environments?.find((entry) => entry.id === id)),
  };
}

export function ProxyLoginScreen(props: TScreenProps) {
  const { env, choices, pick } = useEnvironmentPicker(props);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!env || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const user = resolveProxyUserCredential(env, undefined);
        props.service.notify({ level: "muted", message: `Opening a browser logged in to ${env.displayName} as ${user.userID}...` });
        await openLoggedInBrowserWindow(env, user, (message) => props.service.notify({ level: "muted", message: `  ${message}` }));
        props.service.notify({ level: "success", message: `Logged in as ${user.userID}. The browser window is left open — use it directly.` });
        props.onDone(true);
      } catch (error) {
        props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
        props.onDone(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env]);

  if (!env) {
    if (!choices) return <Text dimColor>Loading environments…</Text>;
    return (
      <SearchableList
        message="Select environment to log in to"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function ProxyStopScreen(props: TScreenProps) {
  const { env, choices, pick } = useEnvironmentPicker(props);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!env || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      if (isProxyEnvironmentRunning(env.id)) {
        await stopProxyEnvironment(env.id);
        props.service.notify({ level: "success", message: `Stopped proxy for ${env.displayName} (this process).` });
        return props.onDone(true);
      }

      let stoppedAny = false;
      for (const port of env.ports) {
        if (await isPortAvailable(port)) continue;
        props.service.notify({ level: "muted", message: `Port ${port} is bound by another process — stopping it...` });
        killProcessUsingPort(port, (line) => props.service.notify({ level: "muted", message: `  ${line}` }));
        stoppedAny = true;
      }

      if (stoppedAny) {
        props.service.notify({ level: "success", message: `Stopped proxy port(s) for ${env.displayName}.` });
      } else {
        props.service.notify({ level: "muted", message: `${env.displayName} does not appear to be running (checked port(s) ${env.ports.join(", ")}).` });
      }
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env]);

  if (!env) {
    if (!choices) return <Text dimColor>Loading environments…</Text>;
    return (
      <SearchableList
        message="Select environment to stop"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function ProxyStatusScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const configPath = resolveProxyConfigPath();
      const environments = loadResolvedProxyEnvironments(configPath);
      props.service.notify({ level: "muted", message: `Config: ${configPath}` });

      if (environments.length === 0) {
        props.service.notify({ level: "muted", message: 'No environments configured yet. Run "proxy add" to create one.' });
        return props.onDone(true);
      }

      for (const env of environments) {
        const runningHere = isProxyEnvironmentRunning(env.id);
        const portsToCheck = runningHere ? getRunningProxyPorts(env.id) : env.ports;
        const boundPorts: number[] = [];
        for (const port of portsToCheck) {
          if (!(await isPortAvailable(port))) boundPorts.push(port);
        }
        const label = boundPorts.length > 0 ? "running" : "stopped";
        props.service.notify({ level: "muted", message: `${env.displayName} (${env.id}) — ${label}${boundPorts.length > 0 ? ` on ${boundPorts.join(", ")}` : ""}` });
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function ProxyListScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const configPath = resolveProxyConfigPath();
    const environments = loadResolvedProxyEnvironments(configPath);
    props.service.notify({ level: "muted", message: `Config: ${configPath}` });

    if (environments.length === 0) {
      props.service.notify({ level: "muted", message: 'No environments configured yet. Run "proxy add" to create one.' });
    } else {
      for (const env of environments) {
        const usableIds = new Set(env.userList.map((user) => user.userID));
        const userLabels = env.knownUserIds.map((userID) => (usableIds.has(userID) ? userID : `${userID} (no password)`));
        props.service.notify({ level: "muted", message: `${env.displayName} (${env.id}) — ports ${env.ports.join(",")} — users: ${userLabels.join(", ") || "(no users)"}` });
      }
    }
    props.onDone(true);
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function ProxyExportScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const [file, setFile] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!file || startedRef.current) return;
    startedRef.current = true;

    try {
      const configPath = resolveProxyConfigPath();
      const exported = exportProxyConfig(configPath, { redactPasswords: true });
      writeFileSync(file, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
      props.service.notify({ level: "success", message: `Exported ${exported.environments.length} environment(s) to ${file} (passwords redacted).` });
      props.onDone(true);
    } catch (error) {
      props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
      props.onDone(false);
    }
  }, [file]);

  if (!file) {
    return (
      <TextInputPrompt
        message="Export to file (passwords redacted — safe to share)"
        initial="proxy-config-export.json"
        onSubmit={setFile}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

/**
 * Native `proxy import`: deliberately redacted-only in this native form —
 * the traditional `--overwrite` full-replace mode isn't offered here since
 * that silently replaces the ENTIRE real proxy config; this always merges
 * (traditional default without `--overwrite`), same safety posture, just
 * without the more destructive flag surfaced.
 */
export function ProxyImportScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const [file, setFile] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!file || startedRef.current) return;
    startedRef.current = true;

    try {
      const configPath = resolveProxyConfigPath();
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { environments?: unknown }).environments)) {
        props.service.notify({ level: "error", message: `${file} doesn't look like a "proxy export" file (expected an "environments" array).` });
        return props.onDone(false);
      }
      const result = importProxyConfig(configPath, parsed as TProxyConfigFile, { overwrite: false });
      props.service.notify({
        level: "success",
        message: `Imported into ${configPath} — +${result.addedEnvironments} new environment(s), ${result.updatedEnvironments} updated, +${result.addedUsers} new user(s)`,
      });
      props.onDone(true);
    } catch (error) {
      props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
      props.onDone(false);
    }
  }, [file]);

  if (!file) {
    return <TextInputPrompt message="Import from file" onSubmit={setFile} onCancel={() => props.onDone(false)} />;
  }

  return <Text dimColor>Working…</Text>;
}
