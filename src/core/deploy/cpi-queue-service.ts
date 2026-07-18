export type TEventMeshQueueDefinition = { name: string; deadMsgQueue?: string; subscription?: string };

/**
 * Predefined queue/subscription topology from the legacy tool — the one thing that WAS
 * hardcoded there (everything else, endpoint/credentials, comes from the uploaded service-key
 * JSON). Kept as the default here too, since it reflects a real, working messaging design, but
 * nothing about the pipeline requires these exact names — a future settings screen can override
 * them without touching this module's logic.
 */
export const CORE_NAMESPACE_QUEUES: TEventMeshQueueDefinition[] = [
  { name: "CPIACTIVATE", deadMsgQueue: "CPIDEADQUEUE", subscription: "CPIACTIVATE/ERPActivated" },
  { name: "CPIGOLDENRECORD", deadMsgQueue: "CPIDEADQUEUEGOLDENREC" },
];

export const OBJECT_NAMESPACE_QUEUES: TEventMeshQueueDefinition[] = [{ name: "CPIQUEUE", deadMsgQueue: "CPIDEADQUEUE", subscription: "CPIStartActivate" }];

const QUEUE_MANAGEMENT_PATH = "hub/rest/api/v1/management/messaging/queues";

export function getQueuesForNamespace(namespace: string): TEventMeshQueueDefinition[] {
  return namespace.includes("event/object") ? OBJECT_NAMESPACE_QUEUES : CORE_NAMESPACE_QUEUES;
}

export type TEventMeshCredentialSet = {
  serviceKeyFileName: string;
  namespace: string;
  managementUri: string;
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
};

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
  const oa2 = management?.oa2 as Record<string, unknown> | undefined;

  if (!namespace || !management || !oa2) return undefined;

  const managementUri = typeof management.uri === "string" ? management.uri : undefined;
  const clientId = typeof oa2.clientid === "string" ? oa2.clientid : undefined;
  const clientSecret = typeof oa2.clientsecret === "string" ? oa2.clientsecret : undefined;
  const tokenEndpoint = typeof oa2.tokenendpoint === "string" ? oa2.tokenendpoint : undefined;

  if (!managementUri || !clientId || !clientSecret || !tokenEndpoint) return undefined;

  return { namespace, managementUri, clientId, clientSecret, tokenEndpoint };
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

async function fetchEventMeshToken(credential: TEventMeshCredentialSet): Promise<string> {
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

/**
 * Live health snapshot for every predefined queue (+ its dead-letter queue) in one Event Mesh
 * namespace, via the same REST Management API `createPredefinedQueues` uses — a bare GET on a
 * queue name returns its current `messageCount`/`unacknowledgedMessageCount`/`consumerCount`
 * (confirmed live), which is exactly what answers "did something actually land here" and "is this
 * backed up with nobody consuming it":
 *   - dead-letter queue with messages sitting in it -> "failed" (processing genuinely failed)
 *   - a normal queue with messages but zero consumers -> "stuck" (backlog, nobody listening)
 *   - a normal queue with messages and at least one consumer -> "busy" (working through a backlog)
 *   - empty -> "healthy"
 */
export async function getQueueHealth(credential: TEventMeshCredentialSet): Promise<TQueueHealthInfo[]> {
  const token = await fetchEventMeshToken(credential);
  const queues = getQueuesForNamespace(credential.namespace);
  const baseUrl = credential.managementUri.replace(/\/+$/, "");

  const targets: Array<{ name: string; isDeadLetter: boolean }> = [];
  for (const queue of queues) {
    targets.push({ name: `${credential.namespace}/${queue.name}`, isDeadLetter: false });
    if (queue.deadMsgQueue) targets.push({ name: `${credential.namespace}/${queue.deadMsgQueue}`, isDeadLetter: true });
  }

  const results: TQueueHealthInfo[] = [];
  for (const target of targets) {
    try {
      const response = await fetch(`${baseUrl}/${QUEUE_MANAGEMENT_PATH}/${encodeURIComponent(target.name)}`, { headers: { authorization: `Bearer ${token}` } });
      if (response.status === 404) {
        results.push({ queueName: target.name, isDeadLetter: target.isDeadLetter, exists: false, status: "missing" });
        continue;
      }
      if (!response.ok) {
        results.push({ queueName: target.name, isDeadLetter: target.isDeadLetter, exists: false, status: "missing", error: `HTTP ${response.status}` });
        continue;
      }

      const data = (await response.json()) as {
        messageCount?: number;
        unacknowledgedMessageCount?: number;
        consumerCount?: number;
        queueSizeInBytes?: number;
        maxQueueSizeInBytes?: number;
      };
      const messageCount = data.messageCount ?? 0;
      const consumerCount = data.consumerCount ?? 0;
      const status: TQueueHealthStatus = target.isDeadLetter && messageCount > 0 ? "failed" : messageCount > 0 && consumerCount === 0 ? "stuck" : messageCount > 0 ? "busy" : "healthy";

      results.push({
        queueName: target.name,
        isDeadLetter: target.isDeadLetter,
        exists: true,
        status,
        messageCount,
        unacknowledgedMessageCount: data.unacknowledgedMessageCount,
        consumerCount,
        queueSizeInBytes: data.queueSizeInBytes,
        maxQueueSizeInBytes: data.maxQueueSizeInBytes,
      });
    } catch (error) {
      results.push({ queueName: target.name, isDeadLetter: target.isDeadLetter, exists: false, status: "missing", error: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}

