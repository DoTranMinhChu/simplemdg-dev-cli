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

/** Extract the fields needed from a BTP Event Mesh service-key JSON (as downloaded from the BTP cockpit). */
export function parseEventMeshServiceKey(fileName: string, rawJson: string): TEventMeshCredentialSet | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return undefined;
  }

  const root = parsed as Record<string, unknown>;
  const credentials = (root.credentials ?? root) as Record<string, unknown>;
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

  return { serviceKeyFileName: fileName, namespace, managementUri, clientId, clientSecret, tokenEndpoint };
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

export type TQueueCreationResult = { queueName: string; ok: boolean; error?: string };

/**
 * Create the predefined queues (+ dead-letter queues + subscriptions) for one Event Mesh
 * credential set, via SAP Event Mesh's documented REST Management API
 * (PUT .../management/messaging/queues/<name> creates a queue with default settings).
 */
export async function createPredefinedQueues(credential: TEventMeshCredentialSet): Promise<TQueueCreationResult[]> {
  const token = await fetchEventMeshToken(credential);
  const queues = getQueuesForNamespace(credential.namespace);
  const baseUrl = credential.managementUri.replace(/\/+$/, "");
  const results: TQueueCreationResult[] = [];

  for (const queue of queues) {
    const queueName = `${credential.namespace}/${queue.name}`;
    try {
      await putEventMeshResource(baseUrl, token, `${QUEUE_MANAGEMENT_PATH}/${encodeURIComponent(queueName)}`, {
        accessType: "unrestricted",
        ...(queue.deadMsgQueue ? { deadMsgQueue: `${credential.namespace}/${queue.deadMsgQueue}` } : {}),
      });

      if (queue.deadMsgQueue) {
        const deadQueueName = `${credential.namespace}/${queue.deadMsgQueue}`;
        await putEventMeshResource(baseUrl, token, `${QUEUE_MANAGEMENT_PATH}/${encodeURIComponent(deadQueueName)}`, { accessType: "unrestricted" }).catch(() => undefined);
      }

      if (queue.subscription) {
        await putEventMeshResource(baseUrl, token, `${QUEUE_MANAGEMENT_PATH}/${encodeURIComponent(queueName)}/subscriptions/${encodeURIComponent(queue.subscription)}`, {});
      }

      results.push({ queueName, ok: true });
    } catch (error) {
      results.push({ queueName, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return results;
}

async function putEventMeshResource(baseUrl: string, token: string, path: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${baseUrl}/${path}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Event Mesh management request failed (HTTP ${response.status}): ${path}`);
  }
}
