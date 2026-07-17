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

export type TCallCapApiOptions = {
  credential: TXsuaaTokenCredential;
  /** The service's real, live-resolved base URL (e.g. `https://simplemdg-srv-bp.cfapps.us10.hana.ondemand.com`) — see cds-service-discovery.ts's `cfAppName` cross-referenced against a live `cf apps` listing. There is no reliable naming convention to reconstruct this from region/space/service-key alone (confirmed empirically: no mta.yaml/manifest.yml exists in a real customer's repos, so a customer's actual CF route is whatever `cf push <app-name>` defaulted to, not a fixed pattern). */
  baseUrl: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Arbitrary query params — `$select`/`$expand`/`$filter`/`$orderby`/`$top`/`$skip`/`$count`/`$inlinecount`, function-import params, etc. Empty-string values are dropped. */
  queryParams?: Record<string, string>;
  body?: unknown;
};

export type TCallCapApiResult = { status: number; ok: boolean; body: unknown; url: string };

/** Proxies the actual authenticated call server-side, avoiding CORS from the browser (same reason the legacy tool did this server-side). */
export async function callCapApi(options: TCallCapApiOptions): Promise<TCallCapApiResult> {
  const token = await fetchXsuaaAccessToken(options.credential);
  const base = options.baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${options.path.startsWith("/") ? "" : "/"}${options.path}`);
  for (const [key, value] of Object.entries(options.queryParams ?? {})) {
    if (value) url.searchParams.set(key, value);
  }

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

/** Fetches the raw `$metadata` EDMX document for a resolved CAP service — parsed by odata-metadata-parser.ts into entity sets/types/function imports. */
export async function fetchODataMetadataXml(options: { credential: TXsuaaTokenCredential; baseUrl: string; path: string }): Promise<string> {
  const token = await fetchXsuaaAccessToken(options.credential);
  const base = options.baseUrl.replace(/\/+$/, "");
  const servicePath = options.path.startsWith("/") ? options.path : `/${options.path}`;
  const response = await fetch(`${base}${servicePath}/$metadata`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`$metadata request failed (HTTP ${response.status})`);
  return await response.text();
}

export type TLiveDiscoveredService = { name: string; path: string };

/**
 * CAP mounts a default index at a service's own root (`GET /`) listing every OData service bound
 * in that app — with a JSON `Accept` header some CAP versions return a machine-readable list
 * (`{ "value": [{ "name", "url" }, ...] }` or a bare array); otherwise it's an HTML "welcome" page
 * with an `<a href="...">` per service. Tried FIRST (see check-api-routes.ts) because it needs
 * nothing but the app's own live route + a valid token — no GitLab access, no source-scanning
 * heuristics. Not guaranteed: some CAP versions/configs disable this index outright (particularly
 * in production), so a `undefined` return here is expected and normal, not an error — callers fall
 * back to scanning the repo's `.cds` sources instead.
 */
export async function discoverServicesViaLiveIndex(credential: TXsuaaTokenCredential, baseUrl: string): Promise<TLiveDiscoveredService[] | undefined> {
  const token = await fetchXsuaaAccessToken(credential);
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/html" },
  });
  if (!response.ok) return undefined;

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("json")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const entries = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { value?: unknown[] })?.value) ? (parsed as { value: unknown[] }).value : undefined;
      const services = (entries ?? [])
        .filter((entry): entry is { name: string; url?: string } => Boolean(entry) && typeof (entry as { name?: unknown }).name === "string")
        .map((entry) => ({ name: entry.name, path: typeof entry.url === "string" && entry.url ? entry.url : `/${entry.name}` }));
      if (services.length) return services;
    } catch {
      // Not actually JSON despite the content-type — fall through to HTML link-scraping below.
    }
  }

  // CAP's default HTML welcome page links each mounted service as e.g. `<a href="/ServiceName/">`.
  const hrefs = Array.from(text.matchAll(/href="([^"]+)"/g)).map((match) => match[1]);
  const seen = new Set<string>();
  const services: TLiveDiscoveredService[] = [];
  for (const href of hrefs) {
    const path = href.split("?")[0].replace(/\/$/, "");
    if (!/^\/[A-Za-z_][\w./-]*$/.test(path) || path.includes("$metadata") || path.includes("//") || seen.has(path)) continue;
    seen.add(path);
    services.push({ name: path.replace(/^\//, ""), path });
  }
  return services.length ? services : undefined;
}
