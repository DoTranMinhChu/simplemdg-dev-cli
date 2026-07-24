import React, { useEffect, useState } from "react";
import { spawn } from "node:child_process";
import { Text } from "ink";
import { StreamingOutputScreen } from "../components/StreamingOutputScreen";
import { MultiSelectList } from "../components/MultiSelectList";
import { getAppsWithCache, parseHttpWatchLine, formatHttpWatchEvent } from "../../commands/cf.command";
import type { StreamingSessionService } from "../services/streaming-session-service";
import type { TCloudFoundryApp } from "../../core/types";

function formatHttpWatchChunk(appName: string, text: string): string {
  const formattedLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const event = parseHttpWatchLine(line);
    if (event) {
      formattedLines.push(formatHttpWatchEvent(appName, event));
    }
  }
  return formattedLines.length ? `${formattedLines.join("\n")}\n` : "";
}

/**
 * Native `cf http-watch`: picks one or more apps (own lightweight
 * multi-picker, same reasoning as CfLogsScreen.tsx — the traditional
 * handler's app resolution calls `prompts` directly), then spawns one piped
 * `cf logs <app>` child per app (same as the traditional handler) and
 * streams every app's parsed/formatted HTTP events, tagged by app name, into
 * one session.
 */
export function CfHttpWatchScreen(props: { service: StreamingSessionService; onDone: (success: boolean) => void; maxVisibleRows?: number }) {
  const [apps, setApps] = useState<TCloudFoundryApp[] | undefined>(undefined);
  const [selectedApps, setSelectedApps] = useState<string[] | undefined>(undefined);

  useEffect(() => {
    void getAppsWithCache({ startBackgroundRefresh: true }).then(setApps);
  }, []);

  useEffect(() => {
    if (!selectedApps || selectedApps.length === 0) {
      return;
    }

    for (const appName of selectedApps) {
      const child = spawn("cf", ["logs", appName], { stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
      props.service.attachChild(child, { tag: appName, transform: (text) => formatHttpWatchChunk(appName, text) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApps]);

  if (!selectedApps) {
    if (!apps) {
      return <Text dimColor>Loading apps…</Text>;
    }

    return (
      <MultiSelectList
        message="Select app(s) to watch HTTP traffic for"
        hint="Space to toggle, Enter to start watching"
        choices={apps.map((app) => ({ title: app.name, value: app.name }))}
        maxVisibleRows={props.maxVisibleRows}
        onSubmit={(values) => (values.length > 0 ? setSelectedApps(values) : props.onDone(false))}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return (
    <StreamingOutputScreen
      service={props.service}
      title={`cf http-watch ${selectedApps.join(", ")}`}
      onDone={props.onDone}
      maxVisibleRows={props.maxVisibleRows}
    />
  );
}
