import React, { useEffect, useRef } from "react";
import { Text } from "ink";
import { readCache } from "../../core/cache";
import { maskToken } from "../../commands/npmrc.command";
import type { InkInteractionService } from "../services/ink-interaction-service";

/** Native `npmrc list`: reimplements the traditional handler's report against `readCache()` directly (the handler itself writes via `console.log`, which would corrupt Ink's live frame if called while it's mounted). */
export function NpmrcListScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const cache = await readCache();
      const notify = (message: string) => props.service.notify({ level: "muted", message });

      notify(`Hosts: ${cache.npmrc.hosts.join(", ") || "N/A"}`);
      notify(`Scopes: ${cache.npmrc.scopes.join(", ") || "N/A"}`);
      notify(`Output files: ${cache.npmrc.outputFileNames.join(", ") || "N/A"}`);

      notify("Tokens:");
      if (cache.npmrc.tokenEntries.length === 0 && cache.npmrc.tokens.length === 0) {
        notify("- N/A");
      } else {
        for (const entry of cache.npmrc.tokenEntries) {
          notify(`- ${entry.label}: ${entry.scope} @ ${entry.host} - ${maskToken(entry.token)}`);
        }
        if (cache.npmrc.tokens.length > 0) {
          notify(`- Legacy tokens: ${cache.npmrc.tokens.length}`);
        }
      }

      notify("Global packages:");
      if (cache.npmrc.packages.length === 0 && cache.npmrc.packageIds.length === 0) {
        notify("- N/A");
      } else {
        for (const entry of cache.npmrc.packages) {
          notify(`- ${entry.packageName} (${entry.packageId}) - ${entry.scope} @ ${entry.host}`);
        }
        for (const packageId of cache.npmrc.packageIds.filter((id) => !cache.npmrc.packages.some((entry) => entry.packageId === id))) {
          notify(`- ${packageId} (${packageId})`);
        }
      }

      notify("Packages by project:");
      const projects = Object.values(cache.npmrc.packageIdsByProject);
      if (projects.length === 0) {
        notify("- N/A");
      } else {
        for (const project of projects) {
          notify(`- ${project.projectName}:`);
          const hasPackages = (project.packages?.length ?? 0) > 0 || project.packageIds.length > 0;
          if (!hasPackages) {
            notify("  - N/A");
            continue;
          }
          for (const entry of project.packages ?? []) {
            notify(`  - ${entry.packageName} (${entry.packageId}) - ${entry.scope} @ ${entry.host}`);
          }
          for (const packageId of project.packageIds.filter((id) => !(project.packages ?? []).some((entry) => entry.packageId === id))) {
            notify(`  - ${packageId} (${packageId})`);
          }
        }
      }

      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}
