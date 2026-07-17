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
import { callCapApi, discoverServicesViaLiveIndex, fetchODataMetadataXml } from "../../../deploy/check-api-service";
import { parseODataMetadata } from "../../../deploy/odata-metadata-parser";
import { getDefaultGitLabAuth } from "../../../gitlab/gitlab-client";
import type { TGitLabGroup } from "../../../gitlab/gitlab-client";
import { resolveServicesForLiveApp } from "../../../deploy/cds-service-discovery";
import { listDeployTargets } from "../../../deploy/deploy-target-store";

function groupFromTarget(target: { gitlabGroupId: number; gitlabGroupPath: string }): TGitLabGroup {
  return { id: target.gitlabGroupId, full_path: target.gitlabGroupPath, name: target.gitlabGroupPath.split("/").pop() ?? target.gitlabGroupPath };
}

/**
 * Check API External's own entry point is a CF org/space (picked live, the same way CF Log/Restart
 * does it) — NOT a "Deploy Target" (a GitLab-group-centric record that exists for Deploy Model's MR
 * workflow). A Deploy Target is consulted here only opportunistically, as a courtesy: IF one happens
 * to already have this exact CF target linked, its GitLab group is reused to power the CDS-scan
 * fallback; if none exists, that fallback is simply unavailable (live-index discovery + a manual
 * path entry still work fine without it) rather than forcing the user to create one first.
 */
async function findGitlabGroupForCfTarget(cfTargetKey: string): Promise<TGitLabGroup | undefined> {
  const targets = await listDeployTargets();
  const match = targets.find((target) => target.cfTargetKey === cfTargetKey);
  return match ? groupFromTarget(match) : undefined;
}

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

  if (url.pathname === "/api/tool/btp/credentials/suggestion" && method === "GET") {
    // Auto-select a previously-imported credential for this CF org/space, if one exists — every
    // srv app in a space shares one xsuaa instance (confirmed against a real customer checkout:
    // identical $XSAPPNAME scopes used uniformly across ~300 approuter routes spanning completely
    // different backend apps), so a credential imported from ANY ONE app in that space is valid
    // for calling ANY OTHER app in the same space. This is what lets the UI skip straight to
    // picking a service instead of re-running the target/app/import wizard.
    const cfTargetKey = url.searchParams.get("cfTargetKey") ?? "";
    if (!cfTargetKey) {
      sendJson(res, { credential: undefined });
      return true;
    }
    try {
      const parts = parseCfTargetKey(cfTargetKey);
      const credentials = await listBtpServiceCredentials();
      const match = credentials.find((item) => item.region === parts.region && item.org === parts.org && item.space === parts.space);
      sendJson(res, { credential: match });
    } catch {
      sendJson(res, { credential: undefined });
    }
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

  if (url.pathname === "/api/tool/check-api/app-services" && method === "GET") {
    // Deliberately lazy: called once for the ONE live CF app the user picked (from the shared,
    // already-cached `/api/btp/apps` listing) — not an eager scan of every repo in a group. See
    // cds-service-discovery.ts's resolveServicesForLiveApp doc for why the eager version (scanning
    // every `_srv_*` GitLab repo up front) was a real, confirmed mistake: it surfaced repos nobody
    // actually has deployed, and firing dozens of repos' worth of GitLab calls at once got silently
    // throttled.
    const cfTargetKey = url.searchParams.get("cfTargetKey") ?? "";
    const appName = url.searchParams.get("appName") ?? "";
    const credentialId = url.searchParams.get("credentialId") ?? "";
    const baseUrl = url.searchParams.get("baseUrl") ?? "";
    const refresh = url.searchParams.get("refresh") === "true";
    if (!cfTargetKey || !appName) {
      sendJson(res, { matched: false, services: [], error: !cfTargetKey ? "cfTargetKey is required" : "appName is required" }, 400);
      return true;
    }

    // Try the app's own live index FIRST — no GitLab dependency at all when this works. Only a
    // best-effort probe (see discoverServicesViaLiveIndex's doc: some CAP configs disable this),
    // so any failure here just falls through to the GitLab-based resolution below, silently.
    if (credentialId && baseUrl && !refresh) {
      try {
        const credential = await getResolvedBtpServiceCredential(credentialId);
        const liveServices = await discoverServicesViaLiveIndex({ clientId: credential.clientId, clientSecret: credential.clientSecret, url: credential.url }, baseUrl);
        if (liveServices?.length) {
          sendJson(res, { matched: true, services: liveServices.map((service) => ({ ...service, sourceFile: "live" })), source: "live-index" });
          return true;
        }
      } catch {
        // Fall through to GitLab.
      }
    }

    // GitLab fallback is opportunistic — only available when some Deploy Target happens to already
    // link this exact CF org/space to a GitLab group. No such link existing is a normal, expected
    // outcome (this CF target may never have been used with Deploy Model), not an error condition.
    const group = await findGitlabGroupForCfTarget(cfTargetKey);
    if (!group) {
      sendJson(res, { matched: false, services: [], error: "No GitLab group is linked to this CF target yet (only used as a fallback here) — enter the service path manually below, or link one via a Deploy Target." });
      return true;
    }

    const auth = await getDefaultGitLabAuth();
    if (!auth) {
      sendJson(res, { matched: false, services: [], error: "Not logged in to GitLab. Run: smdg gitlab login" }, 401);
      return true;
    }

    try {
      const resolved = await resolveServicesForLiveApp(auth, group, appName, { refresh });
      sendJson(res, { ...resolved.data, source: "gitlab", fromCache: resolved.fromCache, updatedAt: resolved.updatedAt });
    } catch (error) {
      sendJson(res, { matched: false, services: [], error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === "/api/tool/check-api/metadata" && method === "GET") {
    const credentialId = url.searchParams.get("credentialId") ?? "";
    const baseUrl = url.searchParams.get("baseUrl") ?? "";
    const servicePath = url.searchParams.get("path") ?? "";
    if (!credentialId || !baseUrl || !servicePath) {
      sendJson(res, { error: "credentialId, baseUrl, and path are required" }, 400);
      return true;
    }
    try {
      const credential = await getResolvedBtpServiceCredential(credentialId);
      const xml = await fetchODataMetadataXml({
        credential: { clientId: credential.clientId, clientSecret: credential.clientSecret, url: credential.url },
        baseUrl,
        path: servicePath,
      });
      sendJson(res, parseODataMetadata(xml));
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/check-api/call" && method === "POST") {
    const body = await readJsonBody(req);
    const credentialId = getString(body, "credentialId");
    const baseUrl = getString(body, "baseUrl");
    if (!credentialId || !baseUrl) {
      sendJson(res, { error: "credentialId and baseUrl are required" }, 400);
      return true;
    }

    try {
      const credential = await getResolvedBtpServiceCredential(credentialId);
      const rawQueryParams = body.queryParams;
      const queryParams =
        rawQueryParams && typeof rawQueryParams === "object" && !Array.isArray(rawQueryParams)
          ? Object.fromEntries(Object.entries(rawQueryParams as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]))
          : undefined;
      const result = await callCapApi({
        credential: { clientId: credential.clientId, clientSecret: credential.clientSecret, url: credential.url },
        baseUrl,
        path: getString(body, "path"),
        method: (getString(body, "method") || "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
        queryParams,
        body: body.body,
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
