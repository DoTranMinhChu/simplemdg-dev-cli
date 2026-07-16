import http from "node:http";
import crypto from "node:crypto";
import { getNumber, getString, readJsonBody, readRawBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth } from "../../../gitlab/gitlab-client";
import type { TGitLabGroup } from "../../../gitlab/gitlab-client";
import { searchProjectMembers } from "../../../gitlab/gitlab-write-client";
import { discoverObjectTypesForGroup, suggestObjectTypeDefaults } from "../../../deploy/object-type-discovery";
import type { TObjectTypeRepoRole } from "../../../deploy/object-type-discovery";
import { addManualObjectType, findDeployTarget, listManualObjectTypes, mergeObjectTypesWithManual, removeManualObjectType, touchDeployTargetUsage } from "../../../deploy/deploy-target-store";
import { previewEdmxImport, resolveUploadPath, runDeployModelJob, saveUploadedEdmx } from "../../../deploy/deploy-model-job";

function groupFromTarget(target: { gitlabGroupId: number; gitlabGroupPath: string }): TGitLabGroup {
  return { id: target.gitlabGroupId, full_path: target.gitlabGroupPath, name: target.gitlabGroupPath.split("/").pop() ?? target.gitlabGroupPath };
}

export async function handleDeployModelApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/deploy-model/upload" && method === "POST") {
    const fileName = req.headers["x-file-name"];
    if (typeof fileName !== "string" || !fileName) {
      sendJson(res, { error: "X-File-Name header is required" }, 400);
      return true;
    }
    try {
      const contents = await readRawBody(req, 50 * 1024 * 1024);
      const { uploadId } = await saveUploadedEdmx(fileName, contents);
      sendJson(res, { uploadId, fileName });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/deploy-model/preview" && method === "POST") {
    const body = await readJsonBody(req);
    try {
      const filePath = await resolveUploadPath(getString(body, "uploadId"));
      const result = await previewEdmxImport(filePath);
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/deploy-model/object-types" && method === "GET") {
    const deployTargetId = url.searchParams.get("deployTargetId") ?? "";
    const refresh = url.searchParams.get("refresh") === "true";
    const target = await findDeployTarget(deployTargetId);
    if (!target) {
      sendJson(res, { objectTypes: [], error: "Deploy target not found" }, 404);
      return true;
    }
    const auth = await getDefaultGitLabAuth();
    if (!auth) {
      sendJson(res, { objectTypes: [], error: "Not logged in to GitLab. Run: smdg gitlab login" }, 401);
      return true;
    }

    try {
      const group = groupFromTarget(target);
      const [discovered, manual] = await Promise.all([discoverObjectTypesForGroup(auth, group, { refresh }), listManualObjectTypes(`${auth.baseUrl}::${group.id}`)]);
      sendJson(res, { objectTypes: mergeObjectTypesWithManual(discovered.data, manual), fromCache: discovered.fromCache, updatedAt: discovered.updatedAt });
    } catch (error) {
      sendJson(res, { objectTypes: [], error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === "/api/tool/deploy-model/object-type-defaults" && method === "GET") {
    const projectId = Number(url.searchParams.get("projectId"));
    const branch = url.searchParams.get("branch") ?? "";
    const auth = await getDefaultGitLabAuth();
    if (!auth || !projectId || !branch) {
      sendJson(res, { error: "auth/projectId/branch required" }, 400);
      return true;
    }
    try {
      const result = await suggestObjectTypeDefaults(auth, projectId, branch);
      sendJson(res, result.data);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === "/api/tool/deploy-model/members" && method === "GET") {
    const projectId = Number(url.searchParams.get("projectId"));
    const query = url.searchParams.get("query") ?? "";
    const auth = await getDefaultGitLabAuth();
    if (!auth || !projectId) {
      sendJson(res, { members: [], error: "auth/projectId required" }, 400);
      return true;
    }
    try {
      sendJson(res, { members: await searchProjectMembers(auth, projectId, query) });
    } catch (error) {
      sendJson(res, { members: [], error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === "/api/tool/deploy-model/manual-object-type" && method === "POST") {
    const body = await readJsonBody(req);
    const deployTargetId = getString(body, "deployTargetId");
    const target = await findDeployTarget(deployTargetId);
    const auth = await getDefaultGitLabAuth();
    if (!target || !auth) {
      sendJson(res, { error: !target ? "Deploy target not found" : "Not logged in to GitLab" }, 400);
      return true;
    }
    const group = groupFromTarget(target);
    const slug = getString(body, "slug");
    if (!slug) {
      sendJson(res, { error: "slug is required" }, 400);
      return true;
    }
    await addManualObjectType(`${auth.baseUrl}::${group.id}`, {
      slug,
      envObjectName: getString(body, "envObjectName") || slug,
      source: "manual",
      repos: [
        {
          projectId: Number(body.projectId),
          pathWithNamespace: getString(body, "pathWithNamespace"),
          role: (getString(body, "role") || "unknown") as TObjectTypeRepoRole,
          defaultBranch: getString(body, "defaultBranch") || target.defaultBranch,
        },
      ],
    });
    sendJson(res, { ok: true });
    return true;
  }

  if (url.pathname === "/api/tool/deploy-model/manual-object-type/remove" && method === "POST") {
    const body = await readJsonBody(req);
    const target = await findDeployTarget(getString(body, "deployTargetId"));
    const auth = await getDefaultGitLabAuth();
    if (!target || !auth) {
      sendJson(res, { error: !target ? "Deploy target not found" : "Not logged in to GitLab" }, 400);
      return true;
    }
    const group = groupFromTarget(target);
    await removeManualObjectType(`${auth.baseUrl}::${group.id}`, getString(body, "slug"));
    sendJson(res, { ok: true });
    return true;
  }

  if (url.pathname === "/api/tool/deploy-model/deploy" && method === "POST") {
    const body = await readJsonBody(req);
    const deployTargetId = getString(body, "deployTargetId");
    const objectTypeSlug = getString(body, "objectTypeSlug");
    const target = await findDeployTarget(deployTargetId);
    const auth = await getDefaultGitLabAuth();

    if (!target || !auth) {
      sendJson(res, { error: !target ? "Deploy target not found" : "Not logged in to GitLab" }, 400);
      return true;
    }

    const group = groupFromTarget(target);
    const discovered = await discoverObjectTypesForGroup(auth, group, {});
    const manual = await listManualObjectTypes(`${auth.baseUrl}::${group.id}`);
    const objectType = mergeObjectTypesWithManual(discovered.data, manual).find((item) => item.slug === objectTypeSlug);

    if (!objectType) {
      sendJson(res, { error: `Object type '${objectTypeSlug}' was not found for this target.` }, 404);
      return true;
    }

    const jobId = crypto.randomUUID();
    const branchPrefix = `feature/${target.defaultBranch}`;
    const assigneeId = getNumber(body, "assigneeId", 0) || undefined;
    const reviewerIds = Array.isArray(body.reviewerIds) ? (body.reviewerIds as unknown[]).map(Number).filter((id) => Number.isFinite(id)) : undefined;

    // Respond immediately with the jobId; progress streams over /api/tool/events (channel:"job").
    sendJson(res, { jobId });

    void runDeployModelJob(jobId, {
      auth,
      uploadId: getString(body, "uploadId"),
      repos: objectType.repos,
      objectTypeSlug: objectType.slug,
      branchPrefix,
      ticketCode: getString(body, "ticketCode") || undefined,
      assigneeId,
      reviewerIds,
    })
      .then(() => touchDeployTargetUsage(target.id))
      .catch(() => undefined);

    return true;
  }

  return false;
}
