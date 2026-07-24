import React, { useEffect, useState } from "react";
import { spawn } from "node:child_process";
import { Text } from "ink";
import { StreamingOutputScreen } from "../components/StreamingOutputScreen";
import { SearchableList } from "../components/SearchableList";
import { getAppsWithCache, buildCloudFoundryLogsArgs, filterCloudFoundryLogsOutput } from "../../commands/cf.command";
import type { StreamingSessionService } from "../services/streaming-session-service";
import type { TCloudFoundryApp } from "../../core/types";

function normalizeLogChunk(text: string): string {
  const filtered = filterCloudFoundryLogsOutput(text, {});
  if (!filtered.trim()) {
    return "";
  }
  return filtered.endsWith("\n") ? filtered : `${filtered}\n`;
}

/**
 * Native `cf logs --follow`: picks an app (own lightweight picker — the
 * traditional handler's `resolveAppSelection` still calls the `prompts`
 * package directly, which would fight Ink for stdin, so this doesn't call
 * into it), then streams the same piped `cf logs` child the traditional CLI
 * path uses (`buildCloudFoundryLogsArgs`/`filterCloudFoundryLogsOutput`,
 * unchanged) into this session's live buffer instead of `console.log`.
 */
export function CfLogsScreen(props: { service: StreamingSessionService; onDone: (success: boolean) => void; maxVisibleRows?: number }) {
  const [apps, setApps] = useState<TCloudFoundryApp[] | undefined>(undefined);
  const [appName, setAppName] = useState<string | undefined>(undefined);

  useEffect(() => {
    void getAppsWithCache({ startBackgroundRefresh: true }).then(setApps);
  }, []);

  useEffect(() => {
    if (!appName) {
      return;
    }

    const child = spawn("cf", buildCloudFoundryLogsArgs({ appName, recent: false }), {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    });

    props.service.attachChild(child, { transform: (text) => normalizeLogChunk(text) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appName]);

  if (!appName) {
    if (!apps) {
      return <Text dimColor>Loading apps…</Text>;
    }

    return (
      <SearchableList
        message="Select app to view logs"
        choices={apps.map((app) => ({ title: app.name, value: app.name }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={setAppName}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <StreamingOutputScreen service={props.service} title={`cf logs ${appName}`} onDone={props.onDone} maxVisibleRows={props.maxVisibleRows} />;
}
