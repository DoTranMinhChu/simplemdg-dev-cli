import http from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth } from "../../../gitlab/gitlab-client";
import type { TGitLabGroup } from "../../../gitlab/gitlab-client";
import { clearPinnedRegistryProjectId, pinRegistryProjectId, resolveRegistryProjectId } from "../../../npmrc/npmrc-project-resolver";

function groupFromQuery(url: URL): TGitLabGroup | undefined {
  const id = Number(url.searchParams.get("groupId"));
  const fullPath = url.searchParams.get("groupPath") ?? "";
  if (!Number.isFinite(id) || !fullPath) return undefined;
  return { id, full_path: fullPath, name: fullPath.split("/").pop() ?? fullPath };
}

export async function handleNpmrcApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/npmrc/resolve" && method === "GET") {
    const group = groupFromQuery(url);
    const auth = await getDefaultGitLabAuth();
    if (!group || !auth) {
      sendJson(res, { error: "groupId, groupPath, and a GitLab login are required" }, 400);
      return true;
    }
    try {
      sendJson(res, await resolveRegistryProjectId(auth, group));
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/npmrc/pin" && method === "POST") {
    const body = await readJsonBody(req);
    const groupId = Number(body.groupId);
    const groupPath = getString(body, "groupPath");
    const packageId = getString(body, "packageId");
    if (!Number.isFinite(groupId) || !groupPath || !packageId) {
      sendJson(res, { error: "groupId, groupPath, and packageId are required" }, 400);
      return true;
    }
    await pinRegistryProjectId({ id: groupId, full_path: groupPath, name: groupPath.split("/").pop() ?? groupPath }, packageId);
    sendJson(res, { ok: true });
    return true;
  }

  if (url.pathname === "/api/tool/npmrc/unpin" && method === "POST") {
    const body = await readJsonBody(req);
    const groupId = Number(body.groupId);
    const groupPath = getString(body, "groupPath");
    if (!Number.isFinite(groupId) || !groupPath) {
      sendJson(res, { error: "groupId and groupPath are required" }, 400);
      return true;
    }
    await clearPinnedRegistryProjectId({ id: groupId, full_path: groupPath, name: groupPath.split("/").pop() ?? groupPath });
    sendJson(res, { ok: true });
    return true;
  }

  return false;
}
