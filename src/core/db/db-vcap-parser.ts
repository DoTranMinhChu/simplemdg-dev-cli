import type { TDatabaseServiceCandidate, TDatabaseType } from "./db-types";

type TVcapServiceEntry = {
  name?: string;
  instance_name?: string;
  label?: string;
  plan?: string;
  tags?: unknown;
  credentials?: Record<string, unknown>;
};

const HANA_HINTS = ["hana", "hana-cloud", "hanatrial", "hdi-shared", "hdi", "saphana"];
const POSTGRES_HINTS = ["postgres", "postgresql", "timescale", "postgresql-db", "postgres-db"];

function toStringValue(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
}

function toNumberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toBooleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return fallback;
}

function buildHaystack(label: string, entry: TVcapServiceEntry, credentials: Record<string, unknown>): string {
  const tags = Array.isArray(entry.tags) ? entry.tags.map(toStringValue).join(" ") : "";
  const credentialUrl = `${toStringValue(credentials.url)} ${toStringValue(credentials.uri)}`;
  return `${label} ${toStringValue(entry.label)} ${toStringValue(entry.name)} ${tags} ${credentialUrl}`.toLowerCase();
}

function matchesAnyHint(haystack: string, hints: string[]): boolean {
  return hints.some((hint) => haystack.includes(hint));
}

function detectHanaCandidate(
  label: string,
  entry: TVcapServiceEntry,
  credentials: Record<string, unknown>,
): TDatabaseServiceCandidate | undefined {
  const host = toStringValue(credentials.host ?? credentials.hostname);
  const user = toStringValue(credentials.user ?? credentials.username ?? credentials.hdi_user);
  const password = toStringValue(credentials.password ?? credentials.hdi_password);

  if (!host || !user || !password) {
    return undefined;
  }

  const schema = toStringValue(
    credentials.schema ?? credentials.currentSchema ?? credentials.hdi_user ?? credentials.user,
  );

  return {
    type: "hana",
    label,
    serviceName: toStringValue(entry.name ?? entry.instance_name ?? label),
    servicePlan: toStringValue(entry.plan) || undefined,
    host,
    port: toNumberValue(credentials.port, 443),
    database: toStringValue(credentials.databaseName ?? credentials.dbname) || undefined,
    schema: schema || undefined,
    username: user,
    password,
    ssl: toBooleanValue(credentials.encrypt, true),
    sslValidateCertificate: toBooleanValue(credentials.sslValidateCertificate ?? credentials.validate_certificate, false),
  };
}

function detectPostgresCandidate(
  label: string,
  entry: TVcapServiceEntry,
  credentials: Record<string, unknown>,
): TDatabaseServiceCandidate | undefined {
  const rawUri = toStringValue(credentials.uri ?? credentials.url);
  let parsedUri: URL | undefined;

  if (rawUri && /^postg(res|resql)?:\/\//i.test(rawUri)) {
    try {
      parsedUri = new URL(rawUri);
    } catch {
      parsedUri = undefined;
    }
  }

  const host = toStringValue(credentials.hostname ?? credentials.host ?? parsedUri?.hostname);
  const username = toStringValue(credentials.username ?? credentials.user ?? parsedUri?.username);
  const password = toStringValue(
    credentials.password ?? (parsedUri?.password ? decodeURIComponent(parsedUri.password) : ""),
  );

  if (!host || !username || !password) {
    return undefined;
  }

  const database = toStringValue(
    credentials.dbname ?? credentials.database ?? parsedUri?.pathname.replace(/^\//, ""),
  );

  return {
    type: "postgresql",
    label,
    serviceName: toStringValue(entry.name ?? entry.instance_name ?? label),
    servicePlan: toStringValue(entry.plan) || undefined,
    host,
    port: toNumberValue(credentials.port ?? parsedUri?.port, 5432),
    database: database || undefined,
    schema: toStringValue(credentials.schema) || "public",
    username,
    password,
    ssl: toBooleanValue(credentials.sslrootcert ? true : credentials.ssl, true),
    sslValidateCertificate: toBooleanValue(credentials.sslValidateCertificate, false),
  };
}

/**
 * Inspect a parsed VCAP_SERVICES object and return every HANA / PostgreSQL
 * service whose credentials are complete enough to connect.
 */
export function detectDatabaseServiceCandidates(vcapServices: unknown): TDatabaseServiceCandidate[] {
  if (!vcapServices || typeof vcapServices !== "object") {
    return [];
  }

  const candidates: TDatabaseServiceCandidate[] = [];

  for (const [label, entries] of Object.entries(vcapServices as Record<string, unknown>)) {
    if (!Array.isArray(entries)) {
      continue;
    }

    for (const rawEntry of entries as TVcapServiceEntry[]) {
      const credentials = (rawEntry.credentials ?? {}) as Record<string, unknown>;

      if (Object.keys(credentials).length === 0) {
        continue;
      }

      const haystack = buildHaystack(label, rawEntry, credentials);
      const isHanaShaped = matchesAnyHint(haystack, HANA_HINTS);
      const isPostgresShaped = matchesAnyHint(haystack, POSTGRES_HINTS) || /^postg(res|resql)?:\/\//i.test(toStringValue(credentials.uri ?? credentials.url));

      if (isPostgresShaped) {
        const postgres = detectPostgresCandidate(label, rawEntry, credentials);
        if (postgres) {
          candidates.push(postgres);
          continue;
        }
      }

      if (isHanaShaped) {
        const hana = detectHanaCandidate(label, rawEntry, credentials);
        if (hana) {
          candidates.push(hana);
        }
      }
    }
  }

  return candidates;
}

export function describeServiceCandidate(candidate: TDatabaseServiceCandidate): string {
  const databaseTypeLabel: Record<TDatabaseType, string> = { hana: "HANA", postgresql: "PostgreSQL" };
  const target = candidate.database || candidate.schema || candidate.host;
  return `${candidate.serviceName} · ${databaseTypeLabel[candidate.type]} · ${target}`;
}
