import http from "node:http";
import { getBoolean, getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth, listRootGroups, readGitLabCache, saveAuth, validateToken, writeGitLabCache } from "../../../gitlab/gitlab-client";
import { listDeployTargets, removeDeployTarget, upsertDeployTarget } from "../../../deploy/deploy-target-store";
import type { TDeployTargetDraft } from "../../../deploy/deploy-target-store";

export async function handleDeployTargetApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  // --- GitLab auth (in-app login, since `smdg gitlab login` is an interactive-terminal-only flow) ---

  if (url.pathname === "/api/tool/gitlab/auth-status" && method === "GET") {
    const auth = await getDefaultGitLabAuth();
    sendJson(res, { isLoggedIn: Boolean(auth), username: auth?.username, name: auth?.name, baseUrl: auth?.baseUrl, expiresAt: auth?.expiresAt });
    return true;
  }

  if (url.pathname === "/api/tool/gitlab/login" && method === "POST") {
    const body = await readJsonBody(req);
    const baseUrl = getString(body, "baseUrl") || "https://gitlab.simplemdg.com";
    const token = getString(body, "token");
    if (!token) {
      sendJson(res, { error: "Personal access token is required." }, 400);
      return true;
    }
    try {
      const auth = await validateToken(baseUrl, token);
      await saveAuth(auth);
      sendJson(res, { username: auth.username, name: auth.name, baseUrl: auth.baseUrl, expiresAt: auth.expiresAt });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 401);
    }
    return true;
  }

  if (url.pathname === "/api/tool/gitlab/logout" && method === "POST") {
    const cache = await readGitLabCache();
    cache.instances = [];
    await writeGitLabCache(cache);
    sendJson(res, { ok: true });
    return true;
  }

  if (url.pathname === "/api/tool/gitlab/groups" && method === "GET") {
    const auth = await getDefaultGitLabAuth();
    if (!auth) {
      sendJson(res, { groups: [], error: "Not logged in to GitLab. Run: smdg gitlab login" }, 401);
      return true;
    }
    const refresh = url.searchParams.get("refresh") === "true";
    const result = await listRootGroups(auth, refresh);
    sendJson(res, { groups: result.data, gitlabBaseUrl: auth.baseUrl, fromCache: result.fromCache });
    return true;
  }

  if (url.pathname === "/api/tool/deploy-targets" && method === "GET") {
    sendJson(res, { targets: await listDeployTargets() });
    return true;
  }

  if (url.pathname === "/api/tool/deploy-targets/save" && method === "POST") {
    const body = await readJsonBody(req);
    const draft: TDeployTargetDraft = {
      id: getString(body, "id") || undefined,
      name: getString(body, "name"),
      gitlabBaseUrl: getString(body, "gitlabBaseUrl"),
      gitlabGroupId: Number(body.gitlabGroupId),
      gitlabGroupPath: getString(body, "gitlabGroupPath"),
      defaultBranch: getString(body, "defaultBranch") || "main",
      cfTargetKey: getString(body, "cfTargetKey") || undefined,
      objectTypeMode: (getString(body, "objectTypeMode") || "custom") as TDeployTargetDraft["objectTypeMode"],
      cdsVersionDefault: (getString(body, "cdsVersionDefault") || "cds8") as TDeployTargetDraft["cdsVersionDefault"],
      isConsolidationDefault: getBoolean(body, "isConsolidationDefault"),
      ticketCodes: Array.isArray(body.ticketCodes) ? (body.ticketCodes as unknown[]).filter((item): item is string => typeof item === "string") : undefined,
    };

    if (!draft.name || !draft.gitlabGroupPath || !Number.isFinite(draft.gitlabGroupId)) {
      sendJson(res, { error: "name, gitlabGroupId, and gitlabGroupPath are required" }, 400);
      return true;
    }

    const saved = await upsertDeployTarget(draft);
    sendJson(res, { target: saved });
    return true;
  }

  if (url.pathname === "/api/tool/deploy-targets/remove" && method === "POST") {
    const body = await readJsonBody(req);
    sendJson(res, { removed: await removeDeployTarget(getString(body, "id")) });
    return true;
  }

  return false;
}
