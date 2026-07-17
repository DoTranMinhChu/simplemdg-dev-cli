import type { IncomingMessage, ServerResponse } from "node:http";
import { getBoolean, getString, readJsonBody, sendJson, sendText } from "../../../studio-shared/studio-server-kit";
import {
  addOrUpdateProxyUser,
  deleteProxyEnvironment,
  deleteProxyUser,
  exportProxyConfig,
  findProxyEnvironmentByUrl,
  findResolvedProxyEnvironment,
  importProxyConfig,
  loadResolvedProxyEnvironments,
  resolveProxyConfigPath,
  resolveProxyUserCredential,
  revealProxyUserPassword,
  setProxyEnvironmentPorts,
  updateProxyEnvironment,
  updateProxyUser,
  upsertProxyEnvironment,
} from "../../proxy-config-store";
import type { TProxyConfigFile } from "../../proxy-types";
import { getRunningProxyPorts, isProxyEnvironmentRunning, stopProxyEnvironment } from "../../proxy-runtime";
import { openLoggedInBrowserWindow } from "../../proxy-auth-browser";
import { appendProxyLog, getLatestProxyStatus } from "../proxy-events";

export async function handleEnvironmentsApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  const pathname = url.pathname;

  if (pathname === "/api/proxy/environments" && method === "GET") {
    const configPath = resolveProxyConfigPath();
    const environments = loadResolvedProxyEnvironments(configPath).map((env) => ({
      id: env.id,
      displayName: env.displayName,
      repo: env.repo,
      name: env.name,
      url: env.url,
      ports: env.ports,
      captureMode: env.captureMode,
      userList: env.userList.map((user) => ({ userID: user.userID })),
      knownUserIds: env.knownUserIds,
      running: isProxyEnvironmentRunning(env.id),
      runningPorts: getRunningProxyPorts(env.id),
      status: getLatestProxyStatus(env.id) ?? null,
    }));
    sendJson(res, { configPath, environments });
    return true;
  }

  if (pathname === "/api/proxy/environments/add" && method === "POST") {
    const body = await readJsonBody(req);
    const repo = getString(body, "repo");
    const name = getString(body, "name");
    const envUrl = getString(body, "url");

    if (!repo || !name || !envUrl) {
      sendJson(res, { error: "repo, name and url are required." }, 400);
      return true;
    }

    const configPath = resolveProxyConfigPath();
    const duplicate = findProxyEnvironmentByUrl(configPath, envUrl);
    if (duplicate) {
      sendJson(res, { error: `URL already configured for ${duplicate.displayName}.` }, 409);
      return true;
    }

    const result = upsertProxyEnvironment(configPath, repo, name, envUrl);
    sendJson(res, result);
    return true;
  }

  if (pathname === "/api/proxy/environments/update" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");
    const repo = getString(body, "repo");
    const name = getString(body, "name");
    const envUrl = getString(body, "url");

    if (!envId || !repo || !name || !envUrl) {
      sendJson(res, { error: "envId, repo, name and url are required." }, 400);
      return true;
    }

    const configPath = resolveProxyConfigPath();
    const duplicate = findProxyEnvironmentByUrl(configPath, envUrl, envId);
    if (duplicate) {
      sendJson(res, { error: `URL already configured for ${duplicate.displayName}.` }, 409);
      return true;
    }

    try {
      const result = updateProxyEnvironment(configPath, envId, { repo, name, url: envUrl });
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/environments/delete" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");

    if (isProxyEnvironmentRunning(envId)) {
      await stopProxyEnvironment(envId);
    }
    const deleted = deleteProxyEnvironment(resolveProxyConfigPath(), envId);
    sendJson(res, { deleted });
    return true;
  }

  if (pathname === "/api/proxy/environments/ports" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");
    const ports = Array.isArray(body.ports)
      ? (body.ports as unknown[]).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : [];

    if (!envId || ports.length === 0) {
      sendJson(res, { error: "envId and a non-empty ports array are required." }, 400);
      return true;
    }

    try {
      setProxyEnvironmentPorts(resolveProxyConfigPath(), envId, ports);
      sendJson(res, { envId, ports });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/users/save" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");
    const userID = getString(body, "userID");
    const password = getString(body, "password");

    if (!envId || !userID || !password) {
      sendJson(res, { error: "envId, userID and password are required." }, 400);
      return true;
    }

    try {
      addOrUpdateProxyUser(resolveProxyConfigPath(), envId, userID, password);
      sendJson(res, { saved: true });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/users/update" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");
    const originalUserID = getString(body, "originalUserID");
    const userID = getString(body, "userID");
    const password = getString(body, "password");

    if (!envId || !originalUserID || !userID) {
      sendJson(res, { error: "envId, originalUserID and userID are required." }, 400);
      return true;
    }

    try {
      updateProxyUser(resolveProxyConfigPath(), envId, originalUserID, { userID, password: password || undefined });
      sendJson(res, { saved: true });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/users/delete" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");
    const userID = getString(body, "userID");
    const deleted = deleteProxyUser(resolveProxyConfigPath(), envId, userID);
    sendJson(res, { deleted });
    return true;
  }

  if (pathname === "/api/proxy/environments/login" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");
    const userID = getString(body, "userID");

    if (!envId) {
      sendJson(res, { error: "envId is required." }, 400);
      return true;
    }

    try {
      const env = findResolvedProxyEnvironment(resolveProxyConfigPath(), envId);
      if (!env) {
        sendJson(res, { error: `Environment ${envId} not found.` }, 404);
        return true;
      }
      const user = resolveProxyUserCredential(env, userID || undefined);
      await openLoggedInBrowserWindow(env, user, (line) => appendProxyLog(envId, line));
      sendJson(res, { opened: true });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/users/reveal" && method === "POST") {
    const body = await readJsonBody(req);
    const envId = getString(body, "envId");
    const userID = getString(body, "userID");

    if (!envId || !userID) {
      sendJson(res, { error: "envId and userID are required." }, 400);
      return true;
    }

    try {
      const password = revealProxyUserPassword(resolveProxyConfigPath(), envId, userID);
      sendJson(res, { password });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/export" && method === "GET") {
    const redactPasswords = url.searchParams.get("redactPasswords") === "true";
    const exported = exportProxyConfig(resolveProxyConfigPath(), { redactPasswords });
    sendText(res, `${JSON.stringify(exported, null, 2)}\n`, "application/json", "proxy-environments-backup.json");
    return true;
  }

  if (pathname === "/api/proxy/import" && method === "POST") {
    const body = await readJsonBody(req);
    const overwrite = getBoolean(body, "overwrite", false);
    const config = body.config as TProxyConfigFile | undefined;

    if (!config || !Array.isArray(config.environments)) {
      sendJson(res, { error: 'Expected a "config" object with an "environments" array (from "smdg proxy export").' }, 400);
      return true;
    }

    try {
      const result = importProxyConfig(resolveProxyConfigPath(), config, { overwrite });
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
