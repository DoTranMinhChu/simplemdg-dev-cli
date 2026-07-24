import React, { useEffect, useRef, useState } from "react";
import path from "node:path";
import fs from "fs-extra";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import { ensureCloudFoundrySessionFromCache, getAppsWithCache, printTarget } from "../../commands/cf.command";
import { parseCloudFoundryEnvironment } from "../../core/cf-env-parser";
import { readCloudFoundryTarget } from "../../core/cf";
import { runCommand } from "../../core/process";
import { readCache, rememberSelectedApp, rememberEnvironmentFileName } from "../../core/cache";
import { resolveRepositoryPath } from "../../core/repository";
import type { InkInteractionService } from "../services/ink-interaction-service";
import type { TCloudFoundryApp } from "../../core/types";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };

export function CfTargetScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const target = await readCloudFoundryTarget();
      printTarget(target, { interaction: props.service, signal: props.service.signal });
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function CfCacheScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const cache = await readCache();
      const json = JSON.stringify(cache.cloudFoundry, null, 2);
      props.service.notify({ level: "muted", message: json });
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function CfAppsScreen(props: TScreenProps) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const ctx = { interaction: props.service, signal: props.service.signal };
        const target = await ensureCloudFoundrySessionFromCache(ctx);
        printTarget(target, ctx);
        const apps = await getAppsWithCache({ startBackgroundRefresh: true });
        for (const app of apps) {
          props.service.notify({ level: "muted", message: [app.name, app.requestedState, app.processes, app.routes].filter(Boolean).join(" | ") });
        }
        props.onDone(true);
      } catch (error) {
        props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
        props.onDone(false);
      }
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

/**
 * Native `cf env`: picks an app (own lightweight picker — same reasoning as
 * CfLogsScreen.tsx, `resolveTargetAndApp`/`resolveAppSelection` call `prompts`
 * directly), then runs the same non-inherited `cf env <app>` capture the
 * traditional handler uses and writes the same JSON/raw file.
 */
export function CfEnvScreen(props: TScreenProps) {
  const [apps, setApps] = useState<TCloudFoundryApp[] | undefined>(undefined);
  const [appName, setAppName] = useState<string | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    void getAppsWithCache({ startBackgroundRefresh: true }).then(setApps);
  }, []);

  useEffect(() => {
    if (!appName || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      try {
        const repositoryPath = await resolveRepositoryPath(process.cwd());
        const cache = await readCache();
        const outputFileName = cache.cloudFoundry.envFileNames[0] ?? "default-env.json";
        const result = await runCommand("cf", ["env", appName]);

        if (result.exitCode !== 0) {
          throw new Error(result.stderr || result.stdout || "cf env failed");
        }

        const outputPath = path.resolve(repositoryPath, outputFileName);
        const parsedEnvironment = parseCloudFoundryEnvironment(result.stdout);
        await fs.writeJson(outputPath, parsedEnvironment, { spaces: 2 });

        await rememberSelectedApp(appName);
        await rememberEnvironmentFileName(outputFileName);

        props.service.notify({ level: "success", message: `Exported clean JSON env to ${outputPath}` });
        props.onDone(true);
      } catch (error) {
        props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
        props.onDone(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appName]);

  if (!appName) {
    if (!apps) return <Text dimColor>Loading apps…</Text>;
    return (
      <SearchableList
        message="Select app to export cf env"
        choices={apps.map((app) => ({ title: app.name, value: app.name }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={setAppName}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}
