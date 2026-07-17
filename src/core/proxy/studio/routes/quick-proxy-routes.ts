import type { IncomingMessage, ServerResponse } from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { captureSessionFromLiveBrowser } from "../../proxy-auth-browser";
import {
  generateQuickProxyId,
  listQuickProxies,
  parseFetchSnippet,
  sessionFromParsedFetch,
  startQuickProxy,
  stopQuickProxy,
  webOriginFromSession,
} from "../../proxy-quick";
import { appendProxyLog } from "../proxy-events";

function parseOptionalPort(body: Record<string, unknown>): number | undefined {
  const raw = body.port;
  if (raw === undefined || raw === null || raw === "") return undefined;
  return Number(raw);
}

export async function handleQuickProxyApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
): Promise<boolean> {
  const pathname = url.pathname;

  // Fallback path: paste a DevTools "Copy as fetch" snippet manually. Primary path is
  // /api/proxy/quick/auto below, which needs no DevTools interaction at all.
  if (pathname === "/api/proxy/quick/paste" && method === "POST") {
    const body = await readJsonBody(req);
    const snippet = getString(body, "snippet").trim();
    if (!snippet) {
      sendJson(res, { error: "Paste a 'Copy as fetch' snippet." }, 400);
      return true;
    }

    const parsed = parseFetchSnippet(snippet);
    if (!parsed) {
      sendJson(res, { error: "Could not find a fetch(url, { headers: {...} }) call in the pasted snippet." }, 400);
      return true;
    }

    const requestedPort = parseOptionalPort(body);
    const id = generateQuickProxyId();
    const session = sessionFromParsedFetch(parsed);
    const webUrl = webOriginFromSession(session, parsed.url);

    try {
      const info = await startQuickProxy(id, session, webUrl, requestedPort, (message) => appendProxyLog(id, message));
      sendJson(res, info);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 400);
    }
    return true;
  }

  // Primary path: opens a real (visible) browser at `url`; the user logs in manually and
  // the session is captured automatically from the first authenticated API call.
  if (pathname === "/api/proxy/quick/auto" && method === "POST") {
    const body = await readJsonBody(req);
    const targetUrl = getString(body, "url").trim();
    if (!targetUrl) {
      sendJson(res, { error: "url is required." }, 400);
      return true;
    }

    const requestedPort = parseOptionalPort(body);
    const id = generateQuickProxyId();

    try {
      const session = await captureSessionFromLiveBrowser(targetUrl, { onLog: (message) => appendProxyLog(id, message) });
      const webUrl = webOriginFromSession(session, targetUrl);
      const info = await startQuickProxy(id, session, webUrl, requestedPort, (message) => appendProxyLog(id, message));
      sendJson(res, info);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/proxy/quick/list" && method === "GET") {
    sendJson(res, { quickProxies: listQuickProxies() });
    return true;
  }

  if (pathname === "/api/proxy/quick/stop" && method === "POST") {
    const body = await readJsonBody(req);
    const id = getString(body, "id");
    const stopped = await stopQuickProxy(id);
    sendJson(res, { stopped });
    return true;
  }

  return false;
}
