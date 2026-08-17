import http from "node:http";
import axios from "axios";
import type { TCapturedSession } from "./proxy-types";
import { isUnauthenticatedRouterShell } from "./proxy-auth-shared";

function isLoginRedirect(responseUrl: string, serviceOrigin: string): boolean {
  if (!responseUrl || !serviceOrigin) return false;
  const isExternal = !responseUrl.startsWith(serviceOrigin);
  const hasLoginPath = /login|signin|logon|sap\/bc\/bsp\/sap\/public\//i.test(responseUrl);
  return isExternal || hasLoginPath;
}

/**
 * A session that captured fine can still go stale mid-flight (SAP session/token expiry). This
 * backend answers that with HTTP 200 and an HTML/JS login-redirect shell instead of a 401/403,
 * so without this check the proxy would just keep serving that shell forever instead of
 * refreshing — see isUnauthenticatedRouterShell for why the shell alone doesn't already trip
 * the 401/403 branch above.
 */
function isUnauthenticatedShellResponse(response: { headers?: Record<string, unknown>; data?: unknown }): boolean {
  const contentType = String(response.headers?.["content-type"] ?? "");
  if (!/^text\/html/i.test(contentType)) return false;
  const body = Buffer.isBuffer(response.data) || response.data instanceof ArrayBuffer ? Buffer.from(response.data as ArrayBuffer).toString("utf8") : "";
  return isUnauthenticatedRouterShell(contentType, body);
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

/** Names the environment and points at the actual fix instead of the old generic "Restart the
 * proxy" — restarting just retries the same broken credentials/session and fails identically,
 * so it wasn't a fix at all, just a delay before the same message reappeared. */
function sessionFailureMessage(options: TProxyForwarderOptions, situation: string): string {
  const label = options.envLabel ? `${options.envLabel}'s` : "This proxy's";
  const fix = options.reloginHint ?? "Check the saved username/password, or sign in manually and retry.";
  return `${label} session ${situation}. ${fix}`;
}

export type TProxyForwarderOptions = {
  /** Returns the currently held session, or null if none has been captured yet. */
  getSession: () => TCapturedSession | null;
  /** Captures/refreshes the session (reason is for logging) and returns the new one, or null on failure. */
  ensureFreshSession: (reason: string) => Promise<TCapturedSession | null>;
  onLog?: (message: string) => void;
  /** Environment display name (or the target URL for a quick/credential-free proxy) — named in every
   * error response below instead of a generic "the proxy", so a person staring at a failed request
   * in their own app knows which of several running environments actually broke. */
  envLabel?: string;
  /** The exact next step to recover this specific proxy's session — a saved environment points at
   * `smdg proxy login <env>`; a quick/credential-free proxy has no saved login to retry, so it
   * points at re-running `smdg proxy quick` instead. Falls back to generic advice if omitted. */
  reloginHint?: string;
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
    handleProxyRequest(req, res, options, onLog).catch((error) => {
      // handleProxyRequest can throw before any response is written — e.g. the client aborts
      // the request body mid-stream (ERR_STREAM_PREMATURE_CLOSE), routine on a tab navigating
      // away or a canceled fetch. Without this .catch(), that becomes an unhandled promise
      // rejection: Node has no listener for it here, so it can crash the whole proxy process
      // (killing every running environment's forwarding at once) instead of just failing this
      // one request.
      onLog(`Unhandled proxy request error: ${error instanceof Error ? error.message : String(error)}`);
      try {
        if (!res.headersSent) {
          sendJsonError(res, 502, "The proxy hit an unexpected error handling this request. See the Studio's log for details.");
        } else if (!res.writableEnded) {
          res.end();
        }
      } catch {
        // The response socket may already be gone (client disconnected) — nothing more to do.
      }
    });
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
      sendJsonError(res, 503, sessionFailureMessage(options, "could not be established"));
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
      sendJsonError(res, 503, sessionFailureMessage(options, "could not be refreshed (missing Referer header)"));
      return;
    }
    try {
      serviceOrigin = getServiceOrigin(session.headers);
    } catch {
      const label = options.envLabel ? `${options.envLabel}'s` : "This proxy's";
      sendJsonError(res, 503, `${label} refreshed session is still missing required headers — this environment's login capture may be misconfigured.`);
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
    ((response.status === 301 || response.status === 302) && isLoginRedirect(redirectUrl, serviceOrigin)) ||
    isUnauthenticatedShellResponse(response);

  if (isExpired) {
    onLog(`Session expired (status ${response.status}). Refreshing...`);
    const freshSession = await options.ensureFreshSession(`Session expired (HTTP ${response.status})`);
    if (!freshSession) {
      sendJsonError(res, 503, sessionFailureMessage(options, "expired and could not be renewed"));
      return;
    }

    let freshOrigin: string;
    try {
      freshOrigin = getServiceOrigin(freshSession.headers);
    } catch {
      const label = options.envLabel ? `${options.envLabel}'s` : "This proxy's";
      sendJsonError(res, 503, `${label} refreshed session is missing a Referer header — this environment's login capture may be misconfigured.`);
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
