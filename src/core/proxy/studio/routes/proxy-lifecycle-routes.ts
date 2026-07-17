import type { IncomingMessage, ServerResponse } from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { findResolvedProxyEnvironment, resolveProxyConfigPath, resolveProxyUserCredential } from "../../proxy-config-store";
import type { TProxyCaptureCallbacks } from "../../proxy-capture";
import type { TProxyStatusEventStage } from "../../proxy-types";
import { getRunningEnvInfo } from "../../proxy-session-manager";
import {
  getRunningProxyPorts,
  listRunningProxyEnvironmentIds,
  startProxyEnvironment,
  stopProxyEnvironment,
} from "../../proxy-runtime";
import { appendProxyLog, emitProxyStage, getLatestProxyStatus, getProxyLogBuffer } from "../proxy-events";

function makeStudioCallbacks(envId: string): TProxyCaptureCallbacks {
  return {
    onLog: (message: string) => appendProxyLog(envId, message),
    onStage: (stage: TProxyStatusEventStage, message: string) => {
      emitProxyStage(envId, stage, message);
      appendProxyLog(envId, message);
    },
  };
}

function parsePortsFromBody(body: Record<string, unknown>): number[] | undefined {
  if (!Array.isArray(body.ports)) return undefined;
  const ports = (body.ports as unknown[]).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
  return ports.length > 0 ? ports : undefined;
}

export async function handleProxyLifecycleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  const pathname = url.pathname;

  if (pathname.startsWith("/api/proxy/start/") && method === "POST") {
    const envId = decodeURIComponent(pathname.slice("/api/proxy/start/".length));
    const body = await readJsonBody(req);
    const requestedUserID = getString(body, "userID") || undefined;
    const ports = parsePortsFromBody(body);

    try {
      const configPath = resolveProxyConfigPath();
      const env = findResolvedProxyEnvironment(configPath, envId);
      if (!env) {
        sendJson(res, { error: `Environment ${envId} not found.` }, 404);
        return true;
      }

      const user = resolveProxyUserCredential(env, requestedUserID);
      emitProxyStage(envId, "starting", "Environment start requested.");
      appendProxyLog(envId, `[manager] Starting ${envId} as ${user.userID}...`);
      const result = await startProxyEnvironment(env, user, { ports, callbacks: makeStudioCallbacks(envId) });
      sendJson(res, { message: "Environment started.", ...result, userID: user.userID });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname.startsWith("/api/proxy/stop/") && method === "POST") {
    const envId = decodeURIComponent(pathname.slice("/api/proxy/stop/".length));
    const body = await readJsonBody(req);
    const port = Number(body.port);
    await stopProxyEnvironment(envId, Number.isInteger(port) && port > 0 ? port : undefined);
    emitProxyStage(envId, "stopped", "Environment stopped.");
    sendJson(res, { message: "Stop signal sent.", envId });
    return true;
  }

  if (pathname.startsWith("/api/proxy/restart/") && method === "POST") {
    const envId = decodeURIComponent(pathname.slice("/api/proxy/restart/".length));
    const body = await readJsonBody(req);
    const requestedUserID = getString(body, "userID") || undefined;

    try {
      await stopProxyEnvironment(envId);
      const configPath = resolveProxyConfigPath();
      const env = findResolvedProxyEnvironment(configPath, envId);
      if (!env) {
        sendJson(res, { error: `Environment ${envId} not found.` }, 404);
        return true;
      }

      const user = resolveProxyUserCredential(env, requestedUserID);
      emitProxyStage(envId, "starting", "Environment restart requested.");
      const result = await startProxyEnvironment(env, user, { callbacks: makeStudioCallbacks(envId) });
      sendJson(res, { message: "Environment restarted.", ...result, userID: user.userID });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/status" && method === "GET") {
    const configPath = resolveProxyConfigPath();
    const running = listRunningProxyEnvironmentIds().map((envId) => ({
      envId,
      ports: getRunningProxyPorts(envId),
      info: getRunningEnvInfo(envId),
      status: getLatestProxyStatus(envId) ?? null,
    }));
    sendJson(res, { configPath, running });
    return true;
  }

  if (pathname.startsWith("/api/proxy/logs/") && method === "GET") {
    const envId = decodeURIComponent(pathname.slice("/api/proxy/logs/".length));
    sendJson(res, { envId, logs: getProxyLogBuffer(envId) });
    return true;
  }

  return false;
}
