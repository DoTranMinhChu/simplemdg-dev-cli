import http from "node:http";
import { getNumber, getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getJiraInfoToDeploy, postJiraWorkLog } from "../../../deploy/jira-client";
import type { TJiraAuth } from "../../../deploy/jira-client";

function readAuth(body: Record<string, unknown>): TJiraAuth {
  return { baseUrl: getString(body, "baseUrl") || "https://laidon.atlassian.net", email: getString(body, "email"), apiToken: getString(body, "apiToken") };
}

export async function handleJiraApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/jira/deploy-info" && method === "POST") {
    const body = await readJsonBody(req);
    try {
      const result = await getJiraInfoToDeploy(readAuth(body), getString(body, "issueKey"));
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/jira/worklog" && method === "POST") {
    const body = await readJsonBody(req);
    try {
      const result = await postJiraWorkLog(readAuth(body), getString(body, "issueKey"), {
        started: getString(body, "started") || new Date().toISOString(),
        timeSpentSeconds: getNumber(body, "timeSpentSeconds", 0),
        comment: getString(body, "comment") || undefined,
      });
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
