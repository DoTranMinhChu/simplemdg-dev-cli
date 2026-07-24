import http from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { withCfTarget } from "../../../cf/cf-target-switcher";
import { getRecentLogsForApps, restartApps, getCloudLoggingDashboardLink, openSshTerminalForApp } from "../../../deploy/cf-log-restart-service";

/** Historical default app-name list from the legacy tool's UI multiselect — an overridable starting point, not a hardcoded requirement (free-text app names always work too, since app names come live from /api/btp/apps). */
export const DEFAULT_CF_LOG_RESTART_APPS = [
  "user",
  "config-admin",
  "config-main",
  "config-system",
  "process-system",
  "process-approver",
  "process-steward",
  "process-event",
  "process-requestor",
];

function getStringArray(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function handleCfLogRestartApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/cf-log-restart/defaults" && method === "GET") {
    sendJson(res, { appNames: DEFAULT_CF_LOG_RESTART_APPS });
    return true;
  }

  if (url.pathname === "/api/tool/cf-log-restart/logs" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appNames = getStringArray(body, "appNames");
    if (!targetKey || !appNames.length) {
      sendJson(res, { error: "targetKey and appNames are required" }, 400);
      return true;
    }
    try {
      const results = await withCfTarget(targetKey, (context) => getRecentLogsForApps(context, appNames));
      sendJson(res, { results });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cf-log-restart/cloud-logging-link" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    if (!targetKey || !appName) {
      sendJson(res, { error: "targetKey and appName are required" }, 400);
      return true;
    }
    try {
      const link = await withCfTarget(targetKey, (context) => getCloudLoggingDashboardLink(context, appName));
      sendJson(res, link);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cf-log-restart/ssh" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    const instanceIndex = getString(body, "instanceIndex") || "0";
    if (!targetKey || !appName) {
      sendJson(res, { error: "targetKey and appName are required" }, 400);
      return true;
    }
    try {
      const result = await withCfTarget(targetKey, (context) => openSshTerminalForApp(context, appName, instanceIndex));
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cf-log-restart/restart" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appNames = getStringArray(body, "appNames");
    if (!targetKey || !appNames.length) {
      sendJson(res, { error: "targetKey and appNames are required" }, 400);
      return true;
    }
    try {
      const results = await withCfTarget(targetKey, (context) => restartApps(context, appNames));
      sendJson(res, { results });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
