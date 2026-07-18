import type { TDestinationServiceCredential } from "../cf/btp-service-credential-parser";

const DESTINATION_API_PATH = "destination-configuration/v1";

async function fetchDestinationServiceToken(credential: TDestinationServiceCredential): Promise<string> {
  const auth = Buffer.from(`${credential.clientId}:${credential.clientSecret}`).toString("base64");
  const response = await fetch(`${credential.tokenUrl.replace(/\/+$/, "")}/oauth/token`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || `Destination service token request failed (HTTP ${response.status})`);
  }
  return json.access_token;
}

export type TDestinationSummary = { name: string; type?: string; url?: string; authentication?: string; proxyType?: string };

/** List every BTP Destination configured for this subaccount — read-only, no secrets in the summary. */
export async function listSubaccountDestinations(credential: TDestinationServiceCredential): Promise<TDestinationSummary[]> {
  const token = await fetchDestinationServiceToken(credential);
  const response = await fetch(`${credential.destinationConfigUri.replace(/\/+$/, "")}/${DESTINATION_API_PATH}/subaccountDestinations`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Listing destinations failed (HTTP ${response.status})${responseText ? `: ${responseText.slice(0, 300)}` : ""}`);
  }
  const json = (await response.json()) as Array<Record<string, unknown>>;
  return json.map((entry) => ({
    name: String(entry.Name ?? ""),
    type: entry.Type ? String(entry.Type) : undefined,
    url: entry.URL ? String(entry.URL) : undefined,
    authentication: entry.Authentication ? String(entry.Authentication) : undefined,
    proxyType: entry.ProxyType ? String(entry.ProxyType) : undefined,
  }));
}

export type TResolvedDestination = {
  name: string;
  url: string;
  /** Ready-to-use `Authorization` header value for calling `url` — resolved from whichever auth
   * type (Basic, OAuth2ClientCredentials, ...) the destination itself is configured with. */
  authorizationHeader: string;
};

/** A real OAuth access token is a JWT: three base64url segments joined by dots. Some auth types
 * (principal propagation / SAML Bearer Assertion chains that need a real end-user identity to
 * exchange) fail server-side and the Destination service still returns something in `authTokens[0]
 * .value` — but it's an error description, not a token — so this catches that before it gets sent
 * on as a bogus `Authorization` header (which otherwise surfaces one confusing hop later, as the
 * *target* system's own "invalid_grant"/UAA rejection instead of the real cause). */
function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Fetch one destination's full, resolved connection details (GET .../destinations/{name} returns
 * the actual target credentials — Basic user/password or an OAuth2 client id/secret/token
 * endpoint — regardless of which auth type it's configured with) and turn it into a single
 * ready-to-send Authorization header, so callers never need to branch on auth type themselves.
 */
export async function resolveDestination(credential: TDestinationServiceCredential, name: string): Promise<TResolvedDestination> {
  const token = await fetchDestinationServiceToken(credential);
  const response = await fetch(`${credential.destinationConfigUri.replace(/\/+$/, "")}/${DESTINATION_API_PATH}/destinations/${encodeURIComponent(name)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Resolving destination '${name}' failed (HTTP ${response.status})${responseText ? `: ${responseText.slice(0, 300)}` : ""}`);
  }
  const json = (await response.json()) as { destinationConfiguration?: Record<string, unknown>; authTokens?: Array<Record<string, unknown>> };
  const config = json.destinationConfiguration ?? {};
  const url = String(config.URL ?? "");
  const authType = config.Authentication ? String(config.Authentication) : "unknown";
  if (!url) throw new Error(`Destination '${name}' has no URL configured`);

  // For BasicAuthentication destinations, `authTokens[0].value` is already the exact base64
  // `user:password` string a Basic Authorization header needs — confirmed live (decodes to
  // `clientId:clientSecret`) — not a bearer token, so it must NOT go through the JWT sanity check
  // below, which is only meaningful for OAuth-shaped auth types.
  const firstToken = json.authTokens?.[0];
  const tokenValue = firstToken?.value ? String(firstToken.value) : undefined;
  const tokenType = firstToken?.type ? String(firstToken.type) : undefined;
  if (tokenValue && (authType === "BasicAuthentication" || /^basic$/i.test(tokenType ?? ""))) {
    return { name, url, authorizationHeader: `Basic ${tokenValue}` };
  }

  const user = config.User ? String(config.User) : undefined;
  const password = config.Password ? String(config.Password) : undefined;
  if (user && password) {
    return { name, url, authorizationHeader: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
  }

  // Remaining auth types (OAuth2ClientCredentials, SAMLAssertion, ...) get a ready-made bearer
  // token from the Destination service — no need to duplicate SAP's own token-fetch logic for
  // each one — but validate it actually looks like a JWT first, since a failed principal-
  // propagation/SAML-Bearer exchange (needs a real end-user identity a headless tool can't
  // provide) still returns *something* here, an error description rather than a token.
  if (tokenValue) {
    if (!looksLikeJwt(tokenValue)) {
      throw new Error(
        `Destination '${name}' (Authentication: ${authType}) did not return a usable token — got: ${tokenValue.slice(0, 300)}. ` +
          `This usually means the auth type needs a real logged-in user's identity to exchange (principal propagation / SAML Bearer Assertion), which a headless tool has no way to provide.`,
      );
    }
    return { name, url, authorizationHeader: `${tokenType ?? "Bearer"} ${tokenValue}` };
  }

  throw new Error(`Destination '${name}' (Authentication: ${authType}) has an authentication type this tool can't resolve (no Basic credentials or bearer token returned)`);
}

export type TCpiMessageProcessingLogEntry = {
  messageGuid: string;
  status?: string;
  integrationFlowName?: string;
  logStart?: string;
  logEnd?: string;
  sender?: string;
  receiver?: string;
  applicationMessageId?: string;
};

/**
 * Recent iflow run history from a CPI tenant's own MessageProcessingLogs OData API — this
 * answers "did SAP/CPI actually attempt to send anything" independent of whether it ever reached
 * Event Mesh, and shows success/failure per run. Read-only (GET only).
 */
export async function fetchMessageProcessingLogs(destination: TResolvedDestination, top = 50): Promise<TCpiMessageProcessingLogEntry[]> {
  // Many CPI-pointing destinations are configured with a specific iflow's own endpoint as the URL
  // (e.g. `.../http/SomeSpecificFlow`, the same pattern seen on the OpenText destination earlier)
  // rather than the tenant's bare host, so any destination-specific path is dropped here. On top of
  // that, a CPI tenant has two distinct CF routes — confirmed against a live 404 ("Requested route
  // ... does not exist") on the runtime host: `<tenant>.it-cpiNNN-rt.cfapps...` handles iflow
  // traffic only, while `/api/v1/...` (MessageProcessingLogs and the rest of the monitoring OData
  // API) lives on the tenant's management route, `<tenant>.it-cpiNNN.cfapps...` — same hostname,
  // `-rt` removed.
  let origin: string;
  try {
    origin = new URL(destination.url).origin.replace(/-rt\.cfapps\./, ".cfapps.");
  } catch {
    throw new Error(`Destination '${destination.name}' has an invalid URL: ${destination.url}`);
  }
  const url = `${origin}/api/v1/MessageProcessingLogs?$format=json&$orderby=LogEnd desc&$top=${top}`;
  const response = await fetch(url, { headers: { authorization: destination.authorizationHeader, accept: "application/json" } });
  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`CPI MessageProcessingLogs request failed (HTTP ${response.status}) on ${destination.name} (${url})${responseText ? `: ${responseText.slice(0, 300)}` : ""}`);
  }
  const json = (await response.json()) as { d?: { results?: Array<Record<string, unknown>> } };
  const results = json.d?.results ?? [];
  return results.map((entry) => ({
    messageGuid: String(entry.MessageGuid ?? ""),
    status: entry.Status ? String(entry.Status) : undefined,
    integrationFlowName: entry.IntegrationFlowName ? String(entry.IntegrationFlowName) : undefined,
    logStart: entry.LogStart ? String(entry.LogStart) : undefined,
    logEnd: entry.LogEnd ? String(entry.LogEnd) : undefined,
    sender: entry.Sender ? String(entry.Sender) : undefined,
    receiver: entry.Receiver ? String(entry.Receiver) : undefined,
    applicationMessageId: entry.ApplicationMessageId ? String(entry.ApplicationMessageId) : undefined,
  }));
}
