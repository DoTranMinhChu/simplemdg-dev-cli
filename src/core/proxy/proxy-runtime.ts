import http from "node:http";
import type { TCapturedSession, TProxyUserCredential, TResolvedProxyEnvironment } from "./proxy-types";
import type { TProxyCaptureCallbacks } from "./proxy-capture";
import { createProxyRequestHandler } from "./proxy-forwarder";
import { ensureInitialSession, getActiveSession, isEnvRunning, refreshSession, stopSession } from "./proxy-session-manager";
import { findRunningPortOwner, killProcessUsingPort, registerBoundPort, unregisterBoundPort } from "./proxy-port-registry";

type TRunningEnvironment = {
  env: TResolvedProxyEnvironment;
  user: TProxyUserCredential;
  servers: Map<number, http.Server>;
};

/**
 * In-process registry tying capture + refresh (proxy-session-manager) and port binding
 * (proxy-port-registry) together into a start/stop lifecycle. Shared by both
 * `smdg proxy start <env>` (usually one entry) and `smdg proxy studio` (many concurrently).
 */
const runningEnvironments = new Map<string, TRunningEnvironment>();

export type TStartProxyOptions = {
  ports?: number[];
  callbacks?: TProxyCaptureCallbacks;
};

export type TStartProxyResult = {
  envId: string;
  ports: number[];
  capturedAt: string;
};

async function bindProxyPort(
  env: TResolvedProxyEnvironment,
  port: number,
  runningEntry: TRunningEnvironment,
  callbacks: TProxyCaptureCallbacks,
  attempt = 0,
): Promise<void> {
  const handler = createProxyRequestHandler({
    getSession: () => getActiveSession(env.id),
    ensureFreshSession: (reason) => refreshSession(env.id, reason, callbacks),
    onLog: (message) => callbacks.onLog?.(message),
  });

  const server = http.createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" && attempt === 0) {
        callbacks.onLog?.(`Port ${port} is busy. Attempting to free it...`);
        killProcessUsingPort(port, callbacks.onLog);
        setTimeout(() => {
          bindProxyPort(env, port, runningEntry, callbacks, attempt + 1).then(resolve, reject);
        }, 800);
        return;
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", () => resolve());
  });

  runningEntry.servers.set(port, server);
  registerBoundPort(port, { ownerId: env.id, ownerName: env.displayName, type: "environment" });
  callbacks.onLog?.(`Proxy listening on http://127.0.0.1:${port} -> ${env.url}`);
}

export async function startProxyEnvironment(
  env: TResolvedProxyEnvironment,
  user: TProxyUserCredential,
  options: TStartProxyOptions = {},
): Promise<TStartProxyResult> {
  const callbacks = options.callbacks ?? {};
  const ports = options.ports && options.ports.length > 0 ? options.ports : env.ports;

  const conflict = ports
    .map((port) => ({ port, owner: findRunningPortOwner(port) }))
    .find((entry) => entry.owner !== null && entry.owner.ownerId !== env.id);
  if (conflict) {
    throw new Error(`Port ${conflict.port} is already in use by ${conflict.owner?.ownerName}.`);
  }

  const existing = runningEnvironments.get(env.id);
  const alreadyRunning = Boolean(existing) && isEnvRunning(env.id);

  const session: TCapturedSession = alreadyRunning
    ? (getActiveSession(env.id) as TCapturedSession)
    : await ensureInitialSession(env, user, callbacks);

  const runningEntry: TRunningEnvironment = existing ?? { env, user, servers: new Map() };
  runningEnvironments.set(env.id, runningEntry);

  const startedPorts: number[] = [];
  for (const port of ports) {
    if (runningEntry.servers.has(port)) continue;
    await bindProxyPort(env, port, runningEntry, callbacks);
    startedPorts.push(port);
  }

  callbacks.onStage?.("proxy-ready", `Proxy ready on port(s) ${Array.from(runningEntry.servers.keys()).join(", ")}.`);

  return {
    envId: env.id,
    ports: Array.from(runningEntry.servers.keys()).sort((a, b) => a - b),
    capturedAt: session.capturedAt,
  };
}

export async function stopProxyEnvironment(envId: string, port?: number): Promise<void> {
  const runningEntry = runningEnvironments.get(envId);
  if (!runningEntry) {
    return;
  }

  const portsToStop = port !== undefined ? [port] : Array.from(runningEntry.servers.keys());

  for (const targetPort of portsToStop) {
    const server = runningEntry.servers.get(targetPort);
    if (!server) continue;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    runningEntry.servers.delete(targetPort);
    unregisterBoundPort(targetPort);
  }

  if (runningEntry.servers.size === 0) {
    runningEnvironments.delete(envId);
    stopSession(envId);
  }
}

export function isProxyEnvironmentRunning(envId: string): boolean {
  return runningEnvironments.has(envId);
}

export function getRunningProxyPorts(envId: string): number[] {
  return Array.from(runningEnvironments.get(envId)?.servers.keys() ?? []).sort((a, b) => a - b);
}

export function listRunningProxyEnvironmentIds(): string[] {
  return Array.from(runningEnvironments.keys());
}
