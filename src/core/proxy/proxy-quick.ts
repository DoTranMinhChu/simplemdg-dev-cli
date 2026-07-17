import http from "node:http";
import type { TCapturedSession, TQuickProxyInfo } from "./proxy-types";
import { createProxyRequestHandler } from "./proxy-forwarder";
import { findNextFreeProxyPort, findRunningPortOwner, registerBoundPort, unregisterBoundPort } from "./proxy-port-registry";

export type TParsedFetchSnippet = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
};

function extractBalancedObjectAfterKey(code: string, key: string): string | null {
  const keyPattern = new RegExp(`["']?${key}["']?\\s*:`);
  const propMatch = keyPattern.exec(code);
  if (!propMatch) return null;

  let i = propMatch.index + propMatch[0].length;
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] !== "{") return null;

  const start = i;
  let depth = 0;
  let inString = false;
  let quoteChar = "";
  let escaped = false;

  for (; i < code.length; i++) {
    const ch = code[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }

  if (depth !== 0) return null;
  return code.slice(start, i);
}

function parseObjectLiteral(raw: string): Record<string, string> | null {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      // eslint-disable-next-line no-new-func
      return Function(`return (${raw})`)();
    } catch {
      return null;
    }
  }
}

/**
 * Parses a browser DevTools "Copy as fetch" snippet: `fetch("<url>", { headers: {...},
 * body, method })`. This remains the offline fallback for `smdg proxy quick --paste` —
 * the primary path is `--auto`, which captures the same information directly via a live
 * Playwright browser (see `proxy-auth-browser.ts`'s `captureSessionFromLiveBrowser`)
 * without any DevTools interaction.
 */
export function parseFetchSnippet(code: string): TParsedFetchSnippet | null {
  const fetchMatch = /fetch\(\s*(["'`])([\s\S]*?)\1\s*,/.exec(code);
  if (!fetchMatch) return null;
  const url = fetchMatch[2];

  const headersRaw = extractBalancedObjectAfterKey(code, "headers");
  if (!headersRaw) return null;
  const headers = parseObjectLiteral(headersRaw);
  if (!headers) return null;

  const methodMatch = /["']?method["']?\s*:\s*["'](\w+)["']/.exec(code);
  const method = methodMatch ? methodMatch[1].toUpperCase() : "GET";

  const bodyMatch = /["']?body["']?\s*:\s*"((?:\\.|[^"\\])*)"/.exec(code);
  const body = bodyMatch ? bodyMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\") : undefined;

  return { url, method, headers, body };
}

export function sessionFromParsedFetch(parsed: TParsedFetchSnippet): TCapturedSession {
  return {
    headers: parsed.headers,
    method: parsed.method,
    url: parsed.url,
    body: parsed.body,
    capturedAt: new Date().toISOString(),
  };
}

export function webOriginFromSession(session: TCapturedSession, fallbackUrl: string): string {
  const referer = session.headers.Referer ?? session.headers.referer;
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // fall through to fallbackUrl
    }
  }

  try {
    return new URL(fallbackUrl).origin;
  } catch {
    return fallbackUrl;
  }
}

type TQuickProxyEntry = {
  id: string;
  port: number;
  url: string;
  createdAt: string;
  session: TCapturedSession;
  server: http.Server;
};

/**
 * Ad-hoc proxies started from a captured/pasted snippet — never saved to the environments
 * file and known upfront not to auto-refresh (there's no stored credential to log back in
 * with), same tradeoff the reference "ProxyHub" project's quick proxy has.
 */
const quickProxies = new Map<string, TQuickProxyEntry>();

/** Generated up front by the caller (not inside `startQuickProxy`) so the caller can key its own logging/events by the same id before the proxy finishes starting. */
export function generateQuickProxyId(): string {
  return `quick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export async function startQuickProxy(
  id: string,
  session: TCapturedSession,
  webUrl: string,
  requestedPort?: number,
  onLog?: (message: string) => void,
): Promise<TQuickProxyInfo> {
  let port: number;
  if (requestedPort !== undefined) {
    const owner = findRunningPortOwner(requestedPort);
    if (owner) {
      throw new Error(`Port ${requestedPort} is already in use by ${owner.ownerName}.`);
    }
    port = requestedPort;
  } else {
    port = await findNextFreeProxyPort();
  }

  const handler = createProxyRequestHandler({
    getSession: () => quickProxies.get(id)?.session ?? null,
    ensureFreshSession: async () => quickProxies.get(id)?.session ?? null,
    onLog,
  });

  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  quickProxies.set(id, { id, port, url: webUrl, createdAt: session.capturedAt, session, server });
  registerBoundPort(port, { ownerId: id, ownerName: webUrl, type: "quick-proxy" });
  onLog?.(`Quick proxy listening on http://127.0.0.1:${port} -> ${webUrl} (no auto-refresh — recapture when it expires).`);

  return { id, port, url: webUrl, createdAt: session.capturedAt };
}

export function listQuickProxies(): TQuickProxyInfo[] {
  return Array.from(quickProxies.values()).map(({ id, port, url, createdAt }) => ({ id, port, url, createdAt }));
}

export async function stopQuickProxy(id: string): Promise<boolean> {
  const entry = quickProxies.get(id);
  if (!entry) {
    return false;
  }

  await new Promise<void>((resolve) => {
    entry.server.close(() => resolve());
    entry.server.closeAllConnections();
  });
  quickProxies.delete(id);
  unregisterBoundPort(entry.port);
  return true;
}

export async function stopAllQuickProxies(): Promise<void> {
  await Promise.all(Array.from(quickProxies.keys()).map((id) => stopQuickProxy(id)));
}
