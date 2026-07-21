const QUEUE_MANAGEMENT_PATH = "hub/rest/api/v1/management/messaging/queues";

export type TEventMeshPublishCredential = { uri: string; clientId: string; clientSecret: string; tokenEndpoint: string };

export type TEventMeshCredentialSet = {
  serviceKeyFileName: string;
  namespace: string;
  managementUri: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  /** The `messaging` array's `httprest`-protocol entry — its own uri + oa2, distinct from the
   * `management` block above. Only this is usable for actually publishing a message; the
   * management credentials are for the Queue Management REST API (queue health, listing) only. */
  publish?: TEventMeshPublishCredential;
};

function extractOa2(entry: Record<string, unknown> | undefined): { clientId: string; clientSecret: string; tokenEndpoint: string } | undefined {
  const oa2 = entry?.oa2 as Record<string, unknown> | undefined;
  const clientId = typeof oa2?.clientid === "string" ? oa2.clientid : undefined;
  const clientSecret = typeof oa2?.clientsecret === "string" ? oa2.clientsecret : undefined;
  const tokenEndpoint = typeof oa2?.tokenendpoint === "string" ? oa2.tokenendpoint : undefined;
  if (!clientId || !clientSecret || !tokenEndpoint) return undefined;
  return { clientId, clientSecret, tokenEndpoint };
}

/**
 * Extract the fields needed from a BTP Event Mesh service-key's `credentials` block — the same
 * shape whether it came from a downloaded service-key JSON (`{ credentials: {...} }` or the bare
 * credentials object itself) or from a live `cf env <app>` VCAP_SERVICES entry, since a bound
 * service instance's `credentials` field is exactly the same JSON a downloaded service-key
 * contains.
 */
function extractEventMeshCredentials(credentials: Record<string, unknown>): Omit<TEventMeshCredentialSet, "serviceKeyFileName"> | undefined {
  const namespace = typeof credentials.namespace === "string" ? credentials.namespace : undefined;
  const managementList = Array.isArray(credentials.management) ? (credentials.management as Array<Record<string, unknown>>) : undefined;
  const management = managementList?.[0];
  const managementOa2 = extractOa2(management);

  if (!namespace || !management || !managementOa2) return undefined;

  const managementUri = typeof management.uri === "string" ? management.uri : undefined;
  if (!managementUri) return undefined;

  const messagingList = Array.isArray(credentials.messaging) ? (credentials.messaging as Array<Record<string, unknown>>) : undefined;
  const httpRestEntry = messagingList?.find((entry) => Array.isArray(entry.protocol) && (entry.protocol as unknown[]).includes("httprest"));
  const httpRestOa2 = extractOa2(httpRestEntry);
  const httpRestUri = typeof httpRestEntry?.uri === "string" ? httpRestEntry.uri : undefined;
  const publish = httpRestUri && httpRestOa2 ? { uri: httpRestUri, ...httpRestOa2 } : undefined;

  return { namespace, managementUri, ...managementOa2, publish };
}

type TVcapServiceEntry = { name?: string; instance_name?: string; label?: string; tags?: unknown; credentials?: Record<string, unknown> };

const EVENT_MESH_HINTS = ["enterprise-messaging", "event-mesh", "event mesh"];

function toStringValue(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/**
 * Inspect a parsed VCAP_SERVICES object (from a live `cf env <app>` on any app that already has
 * an Event Mesh instance bound) and return every enterprise-messaging-shaped service found —
 * the auto-discovery counterpart to `parseEventMeshServiceKey`, so nobody has to manually
 * download+zip service-key files from BTP Cockpit just to find this project's queue topology.
 */
export function detectEventMeshCandidates(vcapServices: unknown): TEventMeshCredentialSet[] {
  if (!vcapServices || typeof vcapServices !== "object") return [];

  const candidates: TEventMeshCredentialSet[] = [];
  for (const [label, entries] of Object.entries(vcapServices as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;

    for (const rawEntry of entries as TVcapServiceEntry[]) {
      const credentials = (rawEntry.credentials ?? {}) as Record<string, unknown>;
      if (Object.keys(credentials).length === 0) continue;

      const tags = Array.isArray(rawEntry.tags) ? rawEntry.tags.map(toStringValue).join(" ") : "";
      const haystack = `${label} ${toStringValue(rawEntry.label)} ${tags}`.toLowerCase();
      if (!EVENT_MESH_HINTS.some((hint) => haystack.includes(hint))) continue;

      const extracted = extractEventMeshCredentials(credentials);
      if (!extracted) continue;
      candidates.push({ serviceKeyFileName: toStringValue(rawEntry.name ?? rawEntry.instance_name ?? label), ...extracted });
    }
  }
  return candidates;
}

async function fetchEventMeshToken(credential: Pick<TEventMeshCredentialSet, "clientId" | "clientSecret" | "tokenEndpoint">): Promise<string> {
  const response = await fetch(credential.tokenEndpoint, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${credential.clientId}:${credential.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const json = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !json.access_token) {
    throw new Error(json.error_description || `Event Mesh token request failed (HTTP ${response.status})`);
  }
  return json.access_token;
}

export type TQueueHealthStatus = "healthy" | "busy" | "stuck" | "failed" | "missing";

export type TQueueHealthInfo = {
  queueName: string;
  isDeadLetter: boolean;
  exists: boolean;
  status: TQueueHealthStatus;
  messageCount?: number;
  unacknowledgedMessageCount?: number;
  consumerCount?: number;
  queueSizeInBytes?: number;
  maxQueueSizeInBytes?: number;
  error?: string;
};

type TRawQueueEntry = {
  name?: unknown;
  queueName?: unknown;
  messageCount?: unknown;
  unacknowledgedMessageCount?: unknown;
  consumerCount?: unknown;
  queueSizeInBytes?: unknown;
  maxQueueSizeInBytes?: unknown;
  deadMsgQueue?: unknown;
};

function rawQueueName(entry: TRawQueueEntry): string | undefined {
  return typeof entry.name === "string" ? entry.name : typeof entry.queueName === "string" ? entry.queueName : undefined;
}

function rawQueueNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/**
 * Every queue currently provisioned for a namespace, via a bare (no name suffix) GET on the Queue
 * Management REST API — confirmed live: it returns a JSON array of `{ name, messageCount,
 * consumerCount, unacknowledgedMessageCount, queueSizeInBytes, maxQueueSizeInBytes, deadMsgQueue,
 * ... }` objects, the exact same data the BTP Cockpit's own "Queues" screen shows. Real queue
 * names for this product aren't in its own source (they're DB-driven config, e.g.
 * EVENTPROCESSQUEUE/STEWARDPROCESSQUEUE/SYSTEMPROCESSQUEUE/... per microservice, not the
 * CPI-integration-flow names this module used to hardcode) — this is the only reliable source.
 */
async function fetchRawQueueList(credential: TEventMeshCredentialSet): Promise<TRawQueueEntry[]> {
  const token = await fetchEventMeshToken(credential);
  const baseUrl = credential.managementUri.replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/${QUEUE_MANAGEMENT_PATH}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Listing queues failed (HTTP ${response.status})${text ? `: ${text.slice(0, 300)}` : ""}`);
  }
  const json = (await response.json().catch(() => undefined)) as unknown;
  if (Array.isArray(json)) return json as TRawQueueEntry[];
  const wrapped = (json as { queues?: unknown })?.queues;
  return Array.isArray(wrapped) ? (wrapped as TRawQueueEntry[]) : [];
}

/**
 * Live health snapshot for every queue that actually exists in one Event Mesh namespace (see
 * `fetchRawQueueList`) — one request lists everyone's message/consumer counts at once, no need to
 * probe queue names one at a time:
 *   - dead-letter queue with messages sitting in it -> "failed" (processing genuinely failed)
 *   - a normal queue with messages but zero consumers -> "stuck" (backlog, nobody listening)
 *   - a normal queue with messages and at least one consumer -> "busy" (working through a backlog)
 *   - empty -> "healthy"
 * Dead-letter queues are identified by cross-referencing every entry's own `deadMsgQueue` field
 * rather than a hardcoded name list, since this product's real DMQ naming isn't fixed.
 */
export async function getQueueHealth(credential: TEventMeshCredentialSet): Promise<TQueueHealthInfo[]> {
  const rawList = await fetchRawQueueList(credential);

  const deadLetterNames = new Set(
    rawList
      .map((entry) => (typeof entry.deadMsgQueue === "string" ? entry.deadMsgQueue : undefined))
      .filter((name): name is string => Boolean(name))
      .map((name) => (name.includes("/") ? name : `${credential.namespace}/${name}`)),
  );

  return rawList
    .map((entry) => {
      const queueName = rawQueueName(entry);
      if (!queueName) return undefined;

      const messageCount = rawQueueNumber(entry.messageCount) ?? 0;
      const consumerCount = rawQueueNumber(entry.consumerCount) ?? 0;
      const isDeadLetter = deadLetterNames.has(queueName);
      const status: TQueueHealthStatus = isDeadLetter && messageCount > 0 ? "failed" : messageCount > 0 && consumerCount === 0 ? "stuck" : messageCount > 0 ? "busy" : "healthy";

      const info: TQueueHealthInfo = {
        queueName,
        isDeadLetter,
        exists: true,
        status,
        messageCount,
        unacknowledgedMessageCount: rawQueueNumber(entry.unacknowledgedMessageCount),
        consumerCount,
        queueSizeInBytes: rawQueueNumber(entry.queueSizeInBytes),
        maxQueueSizeInBytes: rawQueueNumber(entry.maxQueueSizeInBytes),
      };
      return info;
    })
    .filter((info): info is TQueueHealthInfo => Boolean(info));
}

/**
 * Just the names from `fetchRawQueueList` — used for the Send Event tab's queue picker.
 * Best-effort: any failure (network, auth, unexpected shape) yields `[]` rather than throwing, so
 * the caller can fall back to manual entry instead of failing the whole flow.
 */
export async function listEventMeshQueues(credential: TEventMeshCredentialSet): Promise<string[]> {
  try {
    const rawList = await fetchRawQueueList(credential);
    return rawList.map(rawQueueName).filter((name): name is string => Boolean(name));
  } catch {
    return [];
  }
}

export type TEventMeshPublishKind = "topic" | "queue";

export type TEventMeshPublishResult = { status: number; statusText: string; body: string };

/**
 * Publish a test message straight to the Event Mesh broker's own REST API — confirmed live:
 * `POST {uri}/messagingrest/v1/topics/{encoded}/messages` returns 204 and routes to whoever's
 * subscribed (no pre-existing resource needed), while the `/queues/...` variant 404s with "Queue
 * does not exist" unless that exact queue is already provisioned. Returns the raw HTTP result
 * (status/statusText/body) rather than throwing on non-2xx, so a failed send (e.g. an unprovisioned
 * queue) surfaces to the caller as data, not as an exception.
 */
export async function publishEventMeshMessage(credential: TEventMeshCredentialSet, input: { kind: TEventMeshPublishKind; name: string; qos?: string; payload: unknown }): Promise<TEventMeshPublishResult> {
  if (!credential.publish) throw new Error(`${credential.serviceKeyFileName} has no httprest protocol entry in its 'messaging' block — can't publish directly to it.`);

  const token = await fetchEventMeshToken(credential.publish);
  const segment = input.kind === "queue" ? "queues" : "topics";
  const url = `${credential.publish.uri.replace(/\/+$/, "")}/messagingrest/v1/${segment}/${encodeURIComponent(input.name)}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(input.qos ? { "x-qos": input.qos } : {}),
    },
    body: JSON.stringify(input.payload),
  });
  const body = await response.text();
  return { status: response.status, statusText: response.statusText, body };
}

