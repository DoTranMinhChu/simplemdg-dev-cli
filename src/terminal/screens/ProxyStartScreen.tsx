import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { StreamingOutputScreen } from "../components/StreamingOutputScreen";
import { SearchableList } from "../components/SearchableList";
import { loadResolvedProxyEnvironments, resolveProxyUserCredential } from "../../core/proxy/proxy-config-store";
import { resolveProxyConfigPath } from "../../core/proxy/proxy-config-store";
import { startProxyEnvironment, stopProxyEnvironment } from "../../core/proxy/proxy-runtime";
import type { StreamingSessionService } from "../services/streaming-session-service";
import type { TResolvedProxyEnvironment } from "../../core/proxy/proxy-types";

/**
 * Native `cf proxy start <env>`: picks an environment (own lightweight
 * picker — the traditional handler requires the env name as a CLI arg with
 * no interactive fallback), then starts it with `onLog`/`onStage` callbacks
 * pointed at this session's buffer instead of `console.log` (the traditional
 * handler's `cliCallbacks()` equivalent), and stops it via `stopProxyEnvironment`
 * when the session is aborted.
 */
export function ProxyStartScreen(props: { service: StreamingSessionService; onDone: (success: boolean) => void; maxVisibleRows?: number }) {
  const [environments, setEnvironments] = useState<TResolvedProxyEnvironment[] | undefined>(undefined);
  const [envId, setEnvId] = useState<string | undefined>(undefined);

  useEffect(() => {
    setEnvironments(loadResolvedProxyEnvironments(resolveProxyConfigPath()));
  }, []);

  useEffect(() => {
    if (!envId || !environments) {
      return;
    }

    const env = environments.find((entry) => entry.id === envId);
    if (!env) {
      return;
    }

    let stopped = false;
    const onAbort = () => {
      if (stopped) return;
      stopped = true;
      void stopProxyEnvironment(env.id);
    };
    props.service.signal.addEventListener("abort", onAbort, { once: true });

    void (async () => {
      try {
        const user = resolveProxyUserCredential(env, undefined);
        props.service.write(`Starting proxy for ${env.displayName} as ${user.userID}...`);
        const result = await startProxyEnvironment(env, user, {
          callbacks: {
            onLog: (message) => props.service.write(message),
            onStage: (_stage, message) => props.service.write(message),
          },
        });
        props.service.write(`Proxy ready: ${env.displayName} as ${user.userID}`);
        for (const port of result.ports) {
          props.service.write(`  http://127.0.0.1:${port} -> ${env.url}`);
        }
      } catch (error) {
        props.service.write(error instanceof Error ? error.message : String(error), { stream: "stderr" });
        props.service.setStatus("failed");
      }
    })();

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envId, environments]);

  if (!envId) {
    if (!environments) {
      return <Text dimColor>Loading proxy environments…</Text>;
    }

    if (environments.length === 0) {
      return <Text color="yellow">No proxy environments configured — run `smdg proxy add` first.</Text>;
    }

    return (
      <SearchableList
        message="Select proxy environment to start"
        choices={environments.map((env) => ({ title: env.displayName, value: env.id, description: env.url }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={setEnvId}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return (
    <StreamingOutputScreen
      service={props.service}
      title={`proxy start ${environments?.find((entry) => entry.id === envId)?.displayName ?? envId}`}
      onDone={props.onDone}
      maxVisibleRows={props.maxVisibleRows}
    />
  );
}
