import http from "node:http";
import { getNumber, getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { searchIncidents } from "../../../deploy/incident-search-service";

export async function handleIncidentApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/incident/search" && method === "POST") {
    const body = await readJsonBody(req);
    try {
      const results = await searchIncidents({
        supabaseUrl: getString(body, "supabaseUrl"),
        supabaseKey: getString(body, "supabaseKey"),
        ollamaUrl: getString(body, "ollamaUrl"),
        query: getString(body, "query"),
        matchCount: getNumber(body, "matchCount", 30),
        matchThreshold: getNumber(body, "matchThreshold", 0.6),
      });
      sendJson(res, { results });
    } catch (error) {
      sendJson(res, { results: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
