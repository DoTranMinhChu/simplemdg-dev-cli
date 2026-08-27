import http from "node:http";
import { getNumber, getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth } from "../../../gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup } from "../../../gitlab/gitlab-client";
import { listBranches } from "../../../gitlab/gitlab-write-client";
import { discoverObjectTypesForGroup } from "../../../deploy/object-type-discovery";
import type { TDiscoveredObjectType, TObjectTypeRepoRef } from "../../../deploy/object-type-discovery";
import { findDeployTarget, listManualObjectTypes, mergeObjectTypesWithManual } from "../../../deploy/deploy-target-store";
import type { TDeployTarget } from "../../../deploy/deploy-target-store";
import { createMoveModelMergeRequests, previewMoveModelChanges } from "../../../deploy/move-model-job";

/** Same target->group shape `deploy-model-routes.ts` builds — Move Model resolves an object type's repos the same way Deploy Model does, just without ever needing `target.defaultBranch` itself (the user picks both branches explicitly here). */
function groupFromTarget(target: { gitlabGroupId: number; gitlabGroupPath: string }): TGitLabGroup {
  return { id: target.gitlabGroupId, full_path: target.gitlabGroupPath, name: target.gitlabGroupPath.split("/").pop() ?? target.gitlabGroupPath };
}

/** Resolves `deployTargetId`+`objectTypeSlug` into its repos (discovered + manually-added, merged — same as every other object-type-scoped route), optionally narrowed to `repoRoles` (e.g. only `db`, skip `srv`/`srv_process`). Returns an error string instead of throwing so route handlers can respond with a clean 4xx. */
async function resolveObjectTypeRepos(
  target: TDeployTarget,
  auth: TGitLabAuth,
  objectTypeSlug: string,
  repoRoles: string[] | undefined,
): Promise<{ objectType: TDiscoveredObjectType; repos: TObjectTypeRepoRef[] } | { error: string }> {
  const group = groupFromTarget(target);
  const discovered = await discoverObjectTypesForGroup(auth, group, { preferredBranch: target.defaultBranch });
  const manual = await listManualObjectTypes(`${auth.baseUrl}::${group.id}`);
  const objectType = mergeObjectTypesWithManual(discovered.data, manual).find((item) => item.slug === objectTypeSlug);
  if (!objectType) return { error: `Object type '${objectTypeSlug}' was not found for this target.` };

  const repos = repoRoles?.length ? objectType.repos.filter((repo) => repoRoles.includes(repo.role)) : objectType.repos;
  if (!repos.length) return { error: "No matching repo found for this object type (check the selected repo roles)." };
  return { objectType, repos };
}

export async function handleMoveModelApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/move-model/branches" && method === "GET") {
    const projectId = Number(url.searchParams.get("projectId"));
    const search = url.searchParams.get("search") ?? undefined;
    // Defaults to a live fetch (not `refresh === "true"`, inverted from the usual convention) — this
    // list feeds the source/target branch pickers the user is about to open a real Merge Request
    // against, so a stale/cached list (or a legacy `gitlab-branches` cache entry poisoned by a
    // narrower `search`-scoped read elsewhere — see `buildGitLabBranchesKey`'s doc comment) must
    // never silently show fewer branches than actually exist. Pass `refresh=false` to opt back into
    // the cached read.
    const refresh = url.searchParams.get("refresh") !== "false";
    const auth = await getDefaultGitLabAuth();
    if (!auth || !projectId) {
      sendJson(res, { branches: [], error: !auth ? "Not logged in to GitLab" : "projectId required" }, 400);
      return true;
    }
    try {
      const result = await listBranches(auth, projectId, { search, refresh });
      sendJson(res, { branches: result.data, fromCache: result.fromCache, updatedAt: result.updatedAt });
    } catch (error) {
      sendJson(res, { branches: [], error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === "/api/tool/move-model/preview" && method === "POST") {
    const body = await readJsonBody(req);
    const target = await findDeployTarget(getString(body, "deployTargetId"));
    const auth = await getDefaultGitLabAuth();
    if (!target || !auth) {
      sendJson(res, { error: !target ? "Deploy target not found" : "Not logged in to GitLab" }, 400);
      return true;
    }

    const sourceBranch = getString(body, "sourceBranch");
    const targetBranch = getString(body, "targetBranch");
    if (!sourceBranch || !targetBranch) {
      sendJson(res, { error: "sourceBranch and targetBranch are required" }, 400);
      return true;
    }
    if (sourceBranch === targetBranch) {
      sendJson(res, { error: "Source and target branch must be different." }, 400);
      return true;
    }

    const repoRoles = Array.isArray(body.repoRoles) ? (body.repoRoles as unknown[]).map(String) : undefined;
    const resolved = await resolveObjectTypeRepos(target, auth, getString(body, "objectTypeSlug"), repoRoles);
    if ("error" in resolved) {
      sendJson(res, { error: resolved.error }, 404);
      return true;
    }

    try {
      const result = await previewMoveModelChanges({ auth, repos: resolved.repos, sourceBranch, targetBranch });
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/move-model/merge-request" && method === "POST") {
    const body = await readJsonBody(req);
    const target = await findDeployTarget(getString(body, "deployTargetId"));
    const auth = await getDefaultGitLabAuth();
    if (!target || !auth) {
      sendJson(res, { error: !target ? "Deploy target not found" : "Not logged in to GitLab" }, 400);
      return true;
    }

    const sourceBranch = getString(body, "sourceBranch");
    const targetBranch = getString(body, "targetBranch");
    if (!sourceBranch || !targetBranch) {
      sendJson(res, { error: "sourceBranch and targetBranch are required" }, 400);
      return true;
    }
    if (sourceBranch === targetBranch) {
      sendJson(res, { error: "Source and target branch must be different." }, 400);
      return true;
    }

    const repoRoles = Array.isArray(body.repoRoles) ? (body.repoRoles as unknown[]).map(String) : undefined;
    const resolved = await resolveObjectTypeRepos(target, auth, getString(body, "objectTypeSlug"), repoRoles);
    if ("error" in resolved) {
      sendJson(res, { error: resolved.error }, 404);
      return true;
    }

    const assigneeId = getNumber(body, "assigneeId", 0) || undefined;
    const reviewerIds = Array.isArray(body.reviewerIds) ? (body.reviewerIds as unknown[]).map(Number).filter((id) => Number.isFinite(id)) : undefined;

    try {
      const result = await createMoveModelMergeRequests({
        auth,
        repos: resolved.repos,
        sourceBranch,
        targetBranch,
        title: getString(body, "title") || undefined,
        description: getString(body, "description") || undefined,
        assigneeId,
        reviewerIds,
      });
      sendJson(res, result);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
