export type TBtpServiceCredentialCandidate = {
  type: "oauth-client-credentials";
  label: string;
  serviceName: string;
  servicePlan?: string;
  clientId: string;
  clientSecret: string;
  url: string;
  apiUrl?: string;
  identityZone?: string;
};

type TVcapServiceEntry = {
  name?: string;
  instance_name?: string;
  label?: string;
  plan?: string;
  tags?: unknown;
  credentials?: Record<string, unknown>;
};

const XSUAA_HINTS = ["xsuaa", "uaa"];

function toStringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

function buildHaystack(label: string, entry: TVcapServiceEntry, credentials: Record<string, unknown>): string {
  const tags = Array.isArray(entry.tags) ? entry.tags.map(toStringValue).join(" ") : "";
  return `${label} ${toStringValue(entry.label)} ${toStringValue(entry.name)} ${tags}`.toLowerCase();
}

function matchesAnyHint(haystack: string, hints: string[]): boolean {
  return hints.some((hint) => haystack.includes(hint));
}

function detectOAuthCandidate(label: string, entry: TVcapServiceEntry, credentials: Record<string, unknown>): TBtpServiceCredentialCandidate | undefined {
  const clientId = toStringValue(credentials.clientid ?? credentials.clientId);
  const clientSecret = toStringValue(credentials.clientsecret ?? credentials.clientSecret);
  const identityZone = toStringValue(credentials.identityzone ?? credentials.identityZone) || undefined;
  const explicitUrl = toStringValue(credentials.url);
  const url = explicitUrl || (identityZone ? `https://${identityZone}.authentication.${toStringValue(credentials.region ?? "").toLowerCase() || "eu10"}.hana.ondemand.com` : "");

  if (!clientId || !clientSecret || !url) return undefined;

  return {
    type: "oauth-client-credentials",
    label,
    serviceName: toStringValue(entry.name ?? entry.instance_name ?? label),
    servicePlan: toStringValue(entry.plan) || undefined,
    clientId,
    clientSecret,
    url,
    apiUrl: toStringValue(credentials.apiurl ?? credentials.apiUrl) || undefined,
    identityZone,
  };
}

/**
 * Inspect a parsed VCAP_SERVICES object and return every xsuaa/uaa-shaped
 * service whose credentials are complete enough to run an OAuth2
 * client-credentials grant — the generic replacement for `btp-space.json`'s
 * hardcoded clientId/clientSecret map. Mirrors db-vcap-parser.ts's
 * detectDatabaseServiceCandidates hint-array pattern.
 */
export function detectOAuthCredentialCandidates(vcapServices: unknown): TBtpServiceCredentialCandidate[] {
  if (!vcapServices || typeof vcapServices !== "object") return [];

  const candidates: TBtpServiceCredentialCandidate[] = [];

  for (const [label, entries] of Object.entries(vcapServices as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;

    for (const rawEntry of entries as TVcapServiceEntry[]) {
      const credentials = (rawEntry.credentials ?? {}) as Record<string, unknown>;
      if (Object.keys(credentials).length === 0) continue;

      const haystack = buildHaystack(label, rawEntry, credentials);
      if (!matchesAnyHint(haystack, XSUAA_HINTS)) continue;

      const candidate = detectOAuthCandidate(label, rawEntry, credentials);
      if (candidate) candidates.push(candidate);
    }
  }

  return candidates;
}
