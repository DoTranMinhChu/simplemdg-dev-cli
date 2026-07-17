import http from "node:http";
import axios from "axios";
import type { TCapturedSession } from "./proxy-types";

function isLoginRedirect(responseUrl: string, serviceOrigin: string): boolean {
  if (!responseUrl || !serviceOrigin) return false;
  const isExternal = !responseUrl.startsWith(serviceOrigin);
  const hasLoginPath = /login|signin|logon|sap\/bc\/bsp\/sap\/public\//i.test(responseUrl);
  return isExternal || hasLoginPath;
}

function getServiceOrigin(headers: Record<string, string>): string {
  const referer = headers.Referer ?? headers.referer;
  if (!referer) {
    throw new Error("Captured session is missing a Referer header.");
  }
  return new URL(referer).origin;
}

async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function attemptForward(req: http.IncomingMessage, bodyBuffer: Buffer, session: TCapturedSession, serviceOrigin: string) {
  const merged: Record<string, string> = { ...session.headers };

  // Forward content-type from the actual incoming request — captured headers may come
  // from a GET request and have no content-type, which breaks POST/PUT/PATCH calls.
  const incomingContentType = req.headers["content-type"];
  if (incomingContentType) {
    merged["content-type"] = incomingContentType as string;
  }

  // Captured headers can come from a request with no Accept-Language, which makes SAP
  // fall back to raw i18n keys instead of translated text. Forward the browser's own
  // Accept-Language when present, otherwise default to en-US.
  const incomingAcceptLanguage = req.headers["accept-language"];
  if (incomingAcceptLanguage) {
    merged["accept-language"] = incomingAcceptLanguage as string;
  } else if (!merged["accept-language"] && !merged["Accept-Language"]) {
    merged["accept-language"] = "en-US";
  }

  return axios.request({
    method: req.method,
    url: `${serviceOrigin}${req.url ?? "/"}`,
    data: bodyBuffer.length > 0 ? bodyBuffer : undefined,
    headers: merged,
    maxRedirects: 0,
    validateStatus: () => true,
    responseType: "arraybuffer",
  });
}

function sendJsonError(res: http.ServerResponse, status: number, error: string): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error }));
}

export type TProxyForwarderOptions = {
  /** Returns the currently held session, or null if none has been captured yet. */
  getSession: () => TCapturedSession | null;
  /** Captures/refreshes the session (reason is for logging) and returns the new one, or null on failure. */
  ensureFreshSession: (reason: string) => Promise<TCapturedSession | null>;
  onLog?: (message: string) => void;
};

/**
 * Builds the reverse-proxy request handler: forwards every request to the environment's
 * real backend using the currently captured session, detects session expiry (401/403 or
 * a login redirect) and refreshes once before retrying. Ported from the reference
 * "ProxyHub" project's `app.ts` catch-all handler, adapted onto raw `node:http` (this
 * CLI's convention) instead of Express, and refreshing in-process instead of over HTTP to
 * a separate dashboard port.
 */
export function createProxyRequestHandler(options: TProxyForwarderOptions): http.RequestListener {
  const onLog = options.onLog ?? ((): void => undefined);

  return (req, res) => {
    void handleProxyRequest(req, res, options, onLog);
  };
}

async function handleProxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: TProxyForwarderOptions,
  onLog: (message: string) => void,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const bodyBuffer = await readRequestBody(req);

  let session = options.getSession();
  if (!session) {
    session = await options.ensureFreshSession("No session captured yet.");
    if (!session) {
      sendJsonError(res, 503, "No proxy session available.");
      return;
    }
  }

  let serviceOrigin: string;
  try {
    serviceOrigin = getServiceOrigin(session.headers);
  } catch (error) {
    onLog(`Missing/invalid Referer in session headers. Attempting refresh... ${String(error)}`);
    session = await options.ensureFreshSession("Missing Referer header.");
    if (!session) {
      sendJsonError(res, 503, "Session refresh failed. Restart the proxy.");
      return;
    }
    try {
      serviceOrigin = getServiceOrigin(session.headers);
    } catch {
      sendJsonError(res, 503, "No valid proxy session headers found after refresh.");
      return;
    }
  }

  onLog(`${req.method} ${serviceOrigin}${req.url}`);

  let response;
  try {
    response = await attemptForward(req, bodyBuffer, session, serviceOrigin);
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response?.status || 502;
    const message = (error as Error)?.message || "Bad Gateway";
    onLog(`Proxy error: ${status} ${message}`);
    sendJsonError(res, status, message);
    return;
  }

  const redirectUrl = String(response.headers?.location ?? "");
  const isExpired =
    response.status === 401 ||
    response.status === 403 ||
    ((response.status === 301 || response.status === 302) && isLoginRedirect(redirectUrl, serviceOrigin));

  if (isExpired) {
    onLog(`Session expired (status ${response.status}). Refreshing...`);
    const freshSession = await options.ensureFreshSession(`Session expired (HTTP ${response.status})`);
    if (!freshSession) {
      sendJsonError(res, 503, "Session refresh failed. Restart the proxy.");
      return;
    }

    let freshOrigin: string;
    try {
      freshOrigin = getServiceOrigin(freshSession.headers);
    } catch {
      sendJsonError(res, 503, "Refreshed session headers are missing Referer.");
      return;
    }

    try {
      response = await attemptForward(req, bodyBuffer, freshSession, freshOrigin);
      onLog(`Retry after refresh: ${response.status}`);
    } catch (retryError) {
      const retryStatus = (retryError as { response?: { status?: number } })?.response?.status || 502;
      const retryMessage = (retryError as Error)?.message || "Proxy retry failed";
      sendJsonError(res, retryStatus, retryMessage);
      return;
    }
  }

  const responseHeaders = { ...(response.headers as Record<string, unknown>) };
  delete responseHeaders["transfer-encoding"];
  delete responseHeaders["content-encoding"];
  delete responseHeaders["content-length"];

  res.writeHead(response.status ?? 200, responseHeaders as http.OutgoingHttpHeaders);
  res.end(Buffer.from(response.data as ArrayBuffer));
}
