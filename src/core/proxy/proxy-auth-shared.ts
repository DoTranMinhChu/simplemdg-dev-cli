import axios from "axios";
import type { TCapturedSession } from "./proxy-types";

export function getAuthHeaderHints(headers: Record<string, unknown> | undefined): string {
  if (!headers) {
    return "";
  }

  const wwwAuthenticate = headers["www-authenticate"];
  const authHint = headers["authorization"];
  const location = headers.location;
  const hints = [
    wwwAuthenticate ? `www-authenticate=${String(wwwAuthenticate)}` : "",
    authHint ? `authorization=${String(authHint)}` : "",
    location ? `location=${String(location)}` : "",
  ].filter(Boolean);

  return hints.length > 0 ? ` [auth-headers] ${hints.join(" | ")}` : "";
}

export function buildUnauthorizedError(
  stage: string,
  response: { status?: number; headers?: Record<string, unknown> },
): Error {
  const headerHints = getAuthHeaderHints(response.headers);
  return new Error(`Unauthorized at stage '${stage}' (HTTP ${String(response.status ?? 401)}).${headerHints}`);
}

const HTML_CONTENT_TYPE_PATTERN = /^text\/html/i;
const LOGIN_REDIRECT_BODY_PATTERN = /oauth\/authorize|fragmentafterlogin|locationafterlogin|\/saml2\/idp|sap\/bc\/bsp\/sap\/public/i;

/**
 * SAP Approuter's stock response for a request it won't let through (session expired, or the
 * signed-in user's token doesn't cover that specific destination) is HTTP 200 with a small
 * HTML/JS shell that stashes the current URL in a cookie and client-side-redirects into the
 * OAuth/SAML login flow — not a 401/403 or a real 3xx redirect. Every probe/forward path here
 * that only checked "status < 400" was fooled by this: it captured/served that shell as if it
 * were real authenticated JSON, which is how a "successfully captured" session could still be
 * completely unusable. Every request this tool makes asks for `accept: application/json`, so a
 * `text/html` body back is already suspicious; matching it against the shell's own telltale
 * markers confirms it rather than flagging any HTML page.
 */
export function isUnauthenticatedRouterShell(contentType: string | null | undefined, body: string | null | undefined): boolean {
  if (!contentType || !HTML_CONTENT_TYPE_PATTERN.test(contentType)) return false;
  if (!body) return false;
  return LOGIN_REDIRECT_BODY_PATTERN.test(body);
}

/**
 * Renders a captured session for the log console — the whole point being that "did we get a
 * session, and what's actually in it" should be answerable by reading the log, not by
 * instrumenting the code. Multi-line on purpose: the Studio log panels split on newlines, so
 * this renders as one line per field rather than a single hard-to-read blob.
 */
export function formatCapturedSessionForLog(session: TCapturedSession): string {
  const headerEntries = Object.entries(session.headers);
  const headerLines = headerEntries.length > 0 ? headerEntries.map(([key, value]) => `    ${key}: ${value}`).join("\n") : "    (none)";

  return [`  capturedAt: ${session.capturedAt}`, `  method: ${session.method ?? "(n/a)"}`, `  url: ${session.url ?? "(n/a)"}`, `  headers:`, headerLines].join(
    "\n",
  );
}

export function describeAuthError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const code = error.code || "AXIOS_ERROR";
    const headerHints = getAuthHeaderHints(error.response?.headers as Record<string, unknown> | undefined);
    return status ? `${code} / HTTP ${status}: ${error.message}${headerHints}` : `${code}: ${error.message}`;
  }

  if (error instanceof Error) {
    if (/timeout/i.test(error.name) || /timeout/i.test(error.message)) {
      return `TIMEOUT: ${error.message}`;
    }
    return error.message;
  }

  return String(error);
}
