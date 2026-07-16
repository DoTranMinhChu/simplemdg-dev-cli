export type TXsuaaTokenCredential = { clientId: string; clientSecret: string; url: string };

/** Standard XSUAA client-credentials OAuth2 grant. */
export async function fetchXsuaaAccessToken(credential: TXsuaaTokenCredential): Promise<string> {
  const tokenUrl = `${credential.url.replace(/\/+$/, "")}/oauth/token`;
  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${credential.clientId}:${credential.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || `XSUAA token request failed (HTTP ${response.status})`);
  }
  return json.access_token;
}

/**
 * The legacy tool never contacted the customer's CAP service by a stored URL — it derived the
 * route from the Cloud Foundry naming convention, using only the BTP space/region already known
 * for that target: `https://<space>-srv-<serviceKey>[-<objectType>].cfapps.<region>...`. Kept
 * identical here so existing customer CAP deployments (which follow this MTA route convention)
 * resolve without any extra configuration.
 */
export function buildCapServiceBaseUrl(options: { space: string; region: string; serviceKey: string; objectTypeShortName?: string }): string {
  const suffix = options.objectTypeShortName ? `-${options.objectTypeShortName.toLowerCase()}` : "";
  return `https://${options.space}-srv-${options.serviceKey}${suffix}.cfapps.${options.region}.hana.ondemand.com`;
}

export type TCallCapApiOptions = {
  credential: TXsuaaTokenCredential;
  region: string;
  space: string;
  serviceKey: string;
  objectTypeShortName?: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  filter?: string;
  body?: unknown;
};

export type TCallCapApiResult = { status: number; ok: boolean; body: unknown; url: string };

/** Proxies the actual authenticated call server-side, avoiding CORS from the browser (same reason the legacy tool did this server-side). */
export async function callCapApi(options: TCallCapApiOptions): Promise<TCallCapApiResult> {
  const token = await fetchXsuaaAccessToken(options.credential);
  const base = buildCapServiceBaseUrl(options);
  const url = new URL(`${base}${options.path.startsWith("/") ? "" : "/"}${options.path}`);
  if (options.filter) url.searchParams.set("$filter", options.filter);

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  return { status: response.status, ok: response.ok, body, url: url.toString() };
}
