import http from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth } from "../../../gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup } from "../../../gitlab/gitlab-client";
import { discoverObjectTypesForGroup, deriveShortCodeFromRepos } from "../../../deploy/object-type-discovery";
import type { TDiscoveredObjectType } from "../../../deploy/object-type-discovery";
import { findDeployTarget, listManualObjectTypes, mergeObjectTypesWithManual } from "../../../deploy/deploy-target-store";
import type { TDeployTarget } from "../../../deploy/deploy-target-store";
import { saveManualCsnAsUpload } from "../../../deploy/deploy-model-job";
import { draftToCsn, loadManualModelView } from "../../../deploy/csn-manual-editor";
import type { TManualModelDraft } from "../../../deploy/csn-manual-editor";
import { preprocessCsnForMode } from "../../../deploy/csn-preprocess";
import { buildDbModelForNamespace, findRootModel } from "../../../deploy/csn-model-builder";

/**
 * Backs the Deploy Model page's "Edit Model Manually" tab (see `ManualModelEditor.tsx`) — an
 * alternative to "Upload EDMX" for object types that no longer have an EDMX to upload. Produces the
 * same `TCsnContent` shape `cds import` would, and hands it to the *existing* `/deploy-model/preview-changes`
 * and `/deploy-model/deploy` endpoints unchanged (see `saveManualCsnAsUpload`'s doc comment) — this
 * file only needs to load/validate a draft, not run any part of the deploy pipeline itself.
 */

function groupFromTarget(target: { gitlabGroupId: number; gitlabGroupPath: string }): TGitLabGroup {
  return { id: target.gitlabGroupId, full_path: target.gitlabGroupPath, name: target.gitlabGroupPath.split("/").pop() ?? target.gitlabGroupPath };
}

/** Same discover-and-merge lookup `deploy-model-routes.ts` repeats inline at each of its endpoints — kept local to this route file rather than shared, matching that file's own convention. */
async function resolveObjectTypeContext(deployTargetId: string, objectTypeSlug: string): Promise<{ target: TDeployTarget; auth: TGitLabAuth; objectType: TDiscoveredObjectType } | { error: string; status: number }> {
  const target = await findDeployTarget(deployTargetId);
  const auth = await getDefaultGitLabAuth();
  if (!target || !auth) return { error: !target ? "Deploy target not found" : "Not logged in to GitLab. Run: smdg gitlab login", status: 400 };

  const group = groupFromTarget(target);
  const discovered = await discoverObjectTypesForGroup(auth, group, { preferredBranch: target.defaultBranch });
  const manual = await listManualObjectTypes(`${auth.baseUrl}::${group.id}`);
  const objectType = mergeObjectTypesWithManual(discovered.data, manual).find((item) => item.slug === objectTypeSlug);
  if (!objectType) return { error: `Object type '${objectTypeSlug}' was not found for this target.`, status: 404 };

  return { target, auth, objectType };
}

export async function handleManualModelApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/manual-model/view" && method === "GET") {
    const resolved = await resolveObjectTypeContext(url.searchParams.get("deployTargetId") ?? "", url.searchParams.get("objectTypeSlug") ?? "");
    if ("error" in resolved) {
      sendJson(res, { error: resolved.error }, resolved.status);
      return true;
    }
    try {
      sendJson(res, await loadManualModelView(resolved.auth, resolved.objectType.repos, resolved.objectType.envObjectName, resolved.objectType.slug));
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/manual-model/validate" && method === "POST") {
    const body = await readJsonBody(req);
    const resolved = await resolveObjectTypeContext(getString(body, "deployTargetId"), getString(body, "objectTypeSlug"));
    if ("error" in resolved) {
      sendJson(res, { error: resolved.error }, resolved.status);
      return true;
    }
    try {
      const draft = body.draft as TManualModelDraft;
      const csn = draftToCsn(draft, resolved.objectType.envObjectName);
      const preprocessed = preprocessCsnForMode(resolved.target.objectTypeMode, csn);
      const { rootModelName, shortName } = findRootModel(preprocessed, resolved.objectType.envObjectName);
      const built = buildDbModelForNamespace("final", preprocessed, rootModelName, resolved.objectType.envObjectName, shortName, resolved.target.objectTypeMode);
      sendJson(res, { joinRisks: built.joinRisks });
    } catch (error) {
      sendJson(res, { joinRisks: [], error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (url.pathname === "/api/tool/manual-model/save-draft" && method === "POST") {
    const body = await readJsonBody(req);
    const resolved = await resolveObjectTypeContext(getString(body, "deployTargetId"), getString(body, "objectTypeSlug"));
    if ("error" in resolved) {
      sendJson(res, { error: resolved.error }, resolved.status);
      return true;
    }
    try {
      const draft = body.draft as TManualModelDraft;
      const csn = draftToCsn(draft, resolved.objectType.envObjectName);
      const shortCode = deriveShortCodeFromRepos(resolved.objectType.repos);
      if (!shortCode) throw new Error("Could not derive this object type's short code from its repo names — cannot save.");
      const entityName = `MDG_${shortCode.toUpperCase()}`;
      const { uploadId } = await saveManualCsnAsUpload(entityName, JSON.stringify(csn, null, 2));
      sendJson(res, { uploadId, entityName });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
