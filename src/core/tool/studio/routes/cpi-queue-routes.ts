import http from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { detectEventMeshCandidates, getQueueHealth, listEventMeshQueues, publishEventMeshMessage } from "../../../deploy/cpi-queue-service";
import type { TEventMeshCredentialSet, TEventMeshPublishKind, TQueueHealthInfo } from "../../../deploy/cpi-queue-service";
import { fetchMessageProcessingLogs, listSubaccountDestinations, resolveDestination } from "../../../deploy/cpi-integration-service";
import { withCfTarget } from "../../../cf/cf-target-switcher";
import { readAppVcapServicesInContext } from "../../../db/db-btp";
import { detectDestinationServiceCredential } from "../../../cf/btp-service-credential-parser";

export type TCpiQueueHealthResult = {
  serviceKeyFileName: string;
  namespace: string;
  queues: TQueueHealthInfo[];
  error?: string;
};

async function resolveEventMeshCandidate(targetKey: string, appName: string, serviceKeyFileName: string): Promise<TEventMeshCredentialSet> {
  const candidates = await withCfTarget(targetKey, async (context) => {
    const vcapServices = await readAppVcapServicesInContext(context, appName);
    return detectEventMeshCandidates(vcapServices);
  });
  const candidate = candidates.find((entry) => entry.serviceKeyFileName === serviceKeyFileName);
  if (!candidate) throw new Error(`No Event Mesh instance named '${serviceKeyFileName}' was found bound to ${appName}'s cf env.`);
  return candidate;
}

/**
 * Every route here except `/publish` is a GET-shaped lookup (queue counts, destination listing,
 * CPI run history) and never creates, modifies, or deletes anything in BTP — that was a deliberate
 * choice after the queue-creation feature that used to live here was removed at the user's request
 * (see git history if that's ever needed again). `/publish` is the one intentional exception: it
 * sends a test message to Event Mesh, which is the whole point of the Send Event tab.
 */
export async function handleCpiQueueApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/cpi-queue/health" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    if (!targetKey || !appName) {
      sendJson(res, { results: [], error: "targetKey and appName are required" }, 400);
      return true;
    }

    try {
      const candidates = await withCfTarget(targetKey, async (context) => {
        const vcapServices = await readAppVcapServicesInContext(context, appName);
        return detectEventMeshCandidates(vcapServices);
      });

      if (!candidates.length) {
        sendJson(res, { results: [], error: `No Event Mesh (enterprise-messaging) service was found bound to ${appName}'s cf env.` });
        return true;
      }

      const results: TCpiQueueHealthResult[] = [];
      for (const candidate of candidates) {
        try {
          const queues = await getQueueHealth(candidate);
          results.push({ serviceKeyFileName: candidate.serviceKeyFileName, namespace: candidate.namespace, queues });
        } catch (error) {
          results.push({ serviceKeyFileName: candidate.serviceKeyFileName, namespace: candidate.namespace, queues: [], error: error instanceof Error ? error.message : String(error) });
        }
      }
      sendJson(res, { results });
    } catch (error) {
      sendJson(res, { results: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cpi-queue/destinations" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    if (!targetKey || !appName) {
      sendJson(res, { destinations: [], error: "targetKey and appName are required" }, 400);
      return true;
    }

    try {
      const destinations = await withCfTarget(targetKey, async (context) => {
        const vcapServices = await readAppVcapServicesInContext(context, appName);
        const credential = detectDestinationServiceCredential(vcapServices);
        if (!credential) throw new Error(`No destination service was found bound to ${appName}'s cf env.`);
        return listSubaccountDestinations(credential);
      });
      sendJson(res, { destinations });
    } catch (error) {
      sendJson(res, { destinations: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cpi-queue/mpl" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    const destinationName = getString(body, "destinationName");
    if (!targetKey || !appName || !destinationName) {
      sendJson(res, { entries: [], error: "targetKey, appName, and destinationName are required" }, 400);
      return true;
    }

    try {
      const entries = await withCfTarget(targetKey, async (context) => {
        const vcapServices = await readAppVcapServicesInContext(context, appName);
        const credential = detectDestinationServiceCredential(vcapServices);
        if (!credential) throw new Error(`No destination service was found bound to ${appName}'s cf env.`);
        const destination = await resolveDestination(credential, destinationName);
        return fetchMessageProcessingLogs(destination);
      });
      sendJson(res, { entries });
    } catch (error) {
      sendJson(res, { entries: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cpi-queue/instances" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    if (!targetKey || !appName) {
      sendJson(res, { instances: [], error: "targetKey and appName are required" }, 400);
      return true;
    }

    try {
      const candidates = await withCfTarget(targetKey, async (context) => {
        const vcapServices = await readAppVcapServicesInContext(context, appName);
        return detectEventMeshCandidates(vcapServices);
      });
      sendJson(res, { instances: candidates.map((candidate) => ({ serviceKeyFileName: candidate.serviceKeyFileName, namespace: candidate.namespace, canPublish: Boolean(candidate.publish) })) });
    } catch (error) {
      sendJson(res, { instances: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cpi-queue/queues" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    const serviceKeyFileName = getString(body, "serviceKeyFileName");
    if (!targetKey || !appName || !serviceKeyFileName) {
      sendJson(res, { queues: [], error: "targetKey, appName, and serviceKeyFileName are required" }, 400);
      return true;
    }

    try {
      const candidate = await resolveEventMeshCandidate(targetKey, appName, serviceKeyFileName);
      const queues = await listEventMeshQueues(candidate);
      sendJson(res, { queues });
    } catch (error) {
      sendJson(res, { queues: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cpi-queue/publish" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    const serviceKeyFileName = getString(body, "serviceKeyFileName");
    const name = getString(body, "name");
    const kind = (getString(body, "kind") || "topic") as TEventMeshPublishKind;
    if (!targetKey || !appName || !serviceKeyFileName || !name) {
      sendJson(res, { error: "targetKey, appName, serviceKeyFileName, and name are required" }, 400);
      return true;
    }

    try {
      const candidate = await resolveEventMeshCandidate(targetKey, appName, serviceKeyFileName);
      const result = await publishEventMeshMessage(candidate, { kind, name, qos: getString(body, "qos") || undefined, payload: body.payload ?? {} });
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
