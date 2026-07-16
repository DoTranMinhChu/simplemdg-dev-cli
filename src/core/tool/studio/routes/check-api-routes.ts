import http from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { withCfTarget, parseCfTargetKey } from "../../../cf/cf-target-switcher";
import { readAppVcapServicesInContext } from "../../../db/db-btp";
import { detectOAuthCredentialCandidates } from "../../../cf/btp-service-credential-parser";
import {
  getResolvedBtpServiceCredential,
  listBtpServiceCredentials,
  removeBtpServiceCredential,
  saveBtpServiceCredential,
  touchBtpServiceCredentialUsage,
} from "../../../cf/btp-service-credential-store";
import { callCapApi } from "../../../deploy/check-api-service";

export async function handleCheckApiApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/btp/xsuaa-candidates" && method === "GET") {
    const targetKey = url.searchParams.get("targetKey") ?? "";
    const appName = url.searchParams.get("appName") ?? "";
    if (!targetKey || !appName) {
      sendJson(res, { candidates: [], error: "targetKey and appName required" });
      return true;
    }
    try {
      const candidates = await withCfTarget(targetKey, async (context) => {
        const vcapServices = await readAppVcapServicesInContext(context, appName);
        return detectOAuthCredentialCandidates(vcapServices);
      });
      // Never expose secrets to the browser — the client picks a candidate by serviceName and
      // the server re-derives it (from a fresh `cf env`) when actually saving/using it.
      const safeCandidates = candidates.map(({ clientSecret: _secret, ...rest }) => {
        void _secret;
        return rest;
      });
      sendJson(res, { candidates: safeCandidates });
    } catch (error) {
      sendJson(res, { candidates: [], error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === "/api/tool/btp/credentials" && method === "GET") {
    sendJson(res, { credentials: await listBtpServiceCredentials() });
    return true;
  }

  if (url.pathname === "/api/tool/btp/credentials/save" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKey = getString(body, "targetKey");
    const appName = getString(body, "appName");
    const serviceName = getString(body, "serviceName");
    const name = getString(body, "name") || `${appName} / ${serviceName}`;
    if (!targetKey || !appName || !serviceName) {
      sendJson(res, { error: "targetKey, appName, and serviceName are required" }, 400);
      return true;
    }

    let parts: { region: string; org: string; space: string };
    try {
      parts = parseCfTargetKey(targetKey);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 400);
      return true;
    }

    try {
      const saved = await withCfTarget(targetKey, async (context) => {
        const vcapServices = await readAppVcapServicesInContext(context, appName);
        const candidates = detectOAuthCredentialCandidates(vcapServices);
        const chosen = candidates.find((candidate) => candidate.serviceName === serviceName);
        if (!chosen) throw new Error(`Service '${serviceName}' was not found among xsuaa-shaped services in ${appName}'s cf env.`);
        return saveBtpServiceCredential(chosen, { name, region: parts.region, org: parts.org, space: parts.space, app: appName });
      });
      sendJson(res, { credential: saved });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/btp/credentials/remove" && method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, { removed: await removeBtpServiceCredential(getString(body, "id")) });
    return true;
  }

  if (url.pathname === "/api/tool/check-api/call" && method === "POST") {
    const body = await readJsonBody(req);
    const credentialId = getString(body, "credentialId");
    if (!credentialId) {
      sendJson(res, { error: "credentialId is required" }, 400);
      return true;
    }

    try {
      const credential = await getResolvedBtpServiceCredential(credentialId);
      const result = await callCapApi({
        credential: { clientId: credential.clientId, clientSecret: credential.clientSecret, url: credential.url },
        region: getString(body, "region") || credential.region,
        space: getString(body, "space") || credential.space,
        serviceKey: getString(body, "serviceKey"),
        objectTypeShortName: getString(body, "objectTypeShortName") || undefined,
        path: getString(body, "path"),
        method: (getString(body, "method") || "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        filter: getString(body, "filter") || undefined,
      });
      await touchBtpServiceCredentialUsage(credentialId);
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
