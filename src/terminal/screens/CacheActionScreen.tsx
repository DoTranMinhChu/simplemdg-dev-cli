import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import { resolveScopeNamespaces } from "../../commands/cache.command";
import { CACHE_NAMESPACES, clearNamespace, formatRelativeTime, getCacheDirectory, statNamespace } from "../../core/cache/smart-cache";
import type { InkInteractionService } from "../services/ink-interaction-service";

const SCOPE_CHOICES = [
  { title: "All caches", value: "all" },
  { title: "Cloud Foundry (cf)", value: "cf" },
  { title: "GitLab", value: "gitlab" },
  { title: "Database", value: "db" },
  { title: "CF targets/favorites/recent", value: "target" },
  { title: "Dev Proxy sessions", value: "proxy" },
];

type TCacheActionMode = "status" | "clear" | "refresh";

/**
 * Native `cache status`/`clear`/`refresh`: reimplements the traditional
 * handlers' report/scope-picker directly against the underlying smart-cache
 * primitives (rather than calling `printCacheStatus`/`runClear`/`runRefresh`
 * themselves, which write via `console.log` — safe for the traditional CLI's
 * own stdout, but would corrupt Ink's live frame if called while it's
 * mounted). Output goes through `service.notify(...)`, landing in the same
 * permanent scrollback log every other native command's output does.
 */
export function makeCacheActionScreen(
  mode: TCacheActionMode,
): React.ComponentType<{ service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number }> {
  return function CacheActionScreen(props) {
    const [scope, setScope] = useState<string | undefined>(mode === "status" ? "all" : undefined);
    const startedRef = useRef(false);

    useEffect(() => {
      if (!scope || startedRef.current) {
        return;
      }
      startedRef.current = true;

      void (async () => {
        if (mode === "status") {
          const namespaces = Object.keys(CACHE_NAMESPACES);
          const stats = await Promise.all(namespaces.map((namespace) => statNamespace(namespace)));
          const labelWidth = Math.max(...namespaces.map((namespace) => CACHE_NAMESPACES[namespace].length));
          let total = 0;

          for (const stat of stats) {
            const label = CACHE_NAMESPACES[stat.namespace].padEnd(labelWidth);
            total += stat.count;

            if (!stat.exists || stat.count === 0) {
              props.service.notify({ level: "muted", message: `${label}  empty` });
            } else {
              const countText = `${stat.count} item${stat.count === 1 ? "" : "s"}`;
              props.service.notify({ level: "muted", message: `${label}  ${countText} — last updated ${formatRelativeTime(stat.lastUpdatedAt)}` });
            }
          }

          props.service.notify({ level: "muted", message: `${total} cached item(s) total · ${getCacheDirectory()}` });
          props.onDone(true);
          return;
        }

        const namespaces = resolveScopeNamespaces(scope);
        for (const namespace of namespaces) {
          await clearNamespace(namespace);
        }

        const message =
          mode === "clear"
            ? `Cleared cache: ${scope} (${namespaces.length} namespace(s)).`
            : `Marked for refresh: ${scope}. The next ${scope === "all" ? "" : `${scope} `}command will fetch fresh data.`;
        props.service.notify({ level: "success", message });
        props.onDone(true);
      })();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope]);

    if (!scope) {
      return (
        <SearchableList
          message={`Select scope to ${mode}`}
          choices={SCOPE_CHOICES}
          limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
          onSubmit={setScope}
          onCancel={() => props.onDone(false)}
        />
      );
    }

    return <Text dimColor>Working…</Text>;
  };
}
