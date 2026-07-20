import http from "node:http";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth } from "../../../gitlab/gitlab-client";
import type { TGitLabGroup } from "../../../gitlab/gitlab-client";
import { compareBranches, createBranch, commitMultipleFiles, createMergeRequest, deleteBranch, listBranches } from "../../../gitlab/gitlab-write-client";
import { discoverObjectTypesForGroup } from "../../../deploy/object-type-discovery";
import type { TObjectTypeRepoRef } from "../../../deploy/object-type-discovery";
import { findDeployTarget, listManualObjectTypes, mergeObjectTypesWithManual } from "../../../deploy/deploy-target-store";
import { buildFileDiff } from "../../../deploy/deploy-model-job";
import { buildCustomModelCommitActions, loadCustomModelView } from "../../../deploy/custom-model-editor";
import type { TCustomModelEdit } from "../../../deploy/custom-model-editor";
import { fetchRawFile } from "../../../gitlab/gitlab-client";

function groupFromTarget(target: { gitlabGroupId: number; gitlabGroupPath: string }): TGitLabGroup {
  return { id: target.gitlabGroupId, full_path: target.gitlabGroupPath, name: target.gitlabGroupPath.split("/").pop() ?? target.gitlabGroupPath };
}

/** Resolves the object type's `db` repo from a `(deployTargetId, objectTypeSlug)` pair — every Custom Model endpoint needs this same lookup, mirroring `deploy-model-routes.ts`'s own inline pattern. */
async function resolveDbRepo(deployTargetId: string, objectTypeSlug: string): Promise<{ dbRepo?: TObjectTypeRepoRef; auth?: Awaited<ReturnType<typeof getDefaultGitLabAuth>>; error?: string; status?: number }> {
  const target = await findDeployTarget(deployTargetId);
  const auth = await getDefaultGitLabAuth();
  if (!target || !auth) return { error: !target ? "Deploy target not found" : "Not logged in to GitLab. Run: smdg gitlab login", status: 400 };

  const group = groupFromTarget(target);
  const discovered = await discoverObjectTypesForGroup(auth, group, { preferredBranch: target.defaultBranch });
  const manual = await listManualObjectTypes(`${auth.baseUrl}::${group.id}`);
  const objectType = mergeObjectTypesWithManual(discovered.data, manual).find((item) => item.slug === objectTypeSlug);
  if (!objectType) return { error: `Object type '${objectTypeSlug}' was not found for this target.`, status: 404 };

  const dbRepo = objectType.repos.find((repo) => repo.role === "db");
  if (!dbRepo) return { error: `Object type '${objectTypeSlug}' has no 'db' repo — the Custom Model editor needs one.`, status: 400 };

  return { dbRepo, auth };
}

export async function handleCustomModelApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/custom-model/view" && method === "GET") {
    const deployTargetId = url.searchParams.get("deployTargetId") ?? "";
    const objectTypeSlug = url.searchParams.get("objectTypeSlug") ?? "";
    const resolved = await resolveDbRepo(deployTargetId, objectTypeSlug);
    if (!resolved.dbRepo || !resolved.auth) {
      sendJson(res, { error: resolved.error }, resolved.status ?? 400);
      return true;
    }
    try {
      sendJson(res, await loadCustomModelView(resolved.auth, resolved.dbRepo));
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/custom-model/preview" && method === "POST") {
    const body = await readJsonBody(req);
    const deployTargetId = getString(body, "deployTargetId");
    const objectTypeSlug = getString(body, "objectTypeSlug");
    const edits = Array.isArray(body.edits) ? (body.edits as TCustomModelEdit[]) : [];

    const resolved = await resolveDbRepo(deployTargetId, objectTypeSlug);
    if (!resolved.dbRepo || !resolved.auth) {
      sendJson(res, { error: resolved.error }, resolved.status ?? 400);
      return true;
    }

    try {
      const view = await loadCustomModelView(resolved.auth, resolved.dbRepo);
      const { actions, warnings } = await buildCustomModelCommitActions(resolved.auth, resolved.dbRepo, view, edits);

      const files = await Promise.all(
        actions.map(async (action) => {
          const oldContent = await fetchRawFile(resolved.auth!, resolved.dbRepo!.projectId, action.file_path, resolved.dbRepo!.defaultBranch).catch(() => undefined);
          const newContent = action.content ?? "";
          const changeType: "create" | "update" | "no-change" = oldContent === undefined ? "create" : oldContent === newContent ? "no-change" : "update";
          if (changeType === "no-change") return { filePath: action.file_path, changeType, additions: 0, deletions: 0, lines: [] };
          const { lines, additions, deletions } = buildFileDiff(oldContent ?? "", newContent);
          return { filePath: action.file_path, changeType, additions, deletions, lines };
        }),
      );

      sendJson(res, {
        entityName: "Custom Model",
        repos: [{ role: "db", pathWithNamespace: resolved.dbRepo.pathWithNamespace, files }],
        renamedEntities: [],
        customModelWarnings: warnings.map((message) => ({ businessTable: "", message })),
      });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/custom-model/save" && method === "POST") {
    const body = await readJsonBody(req);
    const deployTargetId = getString(body, "deployTargetId");
    const objectTypeSlug = getString(body, "objectTypeSlug");
    const edits = Array.isArray(body.edits) ? (body.edits as TCustomModelEdit[]) : [];

    const target = await findDeployTarget(deployTargetId);
    const resolved = await resolveDbRepo(deployTargetId, objectTypeSlug);
    if (!resolved.dbRepo || !resolved.auth || !target) {
      sendJson(res, { error: resolved.error ?? "Deploy target not found" }, resolved.status ?? 400);
      return true;
    }
    const { auth, dbRepo } = resolved as { auth: NonNullable<typeof resolved.auth>; dbRepo: TObjectTypeRepoRef };

    try {
      const view = await loadCustomModelView(auth, dbRepo);
      const { actions, warnings } = await buildCustomModelCommitActions(auth, dbRepo, view, edits);

      const dateSuffix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const branchName = `feature/${target.defaultBranch}-custom-model-${dateSuffix}`;

      const existingBranches = await listBranches(auth, dbRepo.projectId, { search: branchName, refresh: true });
      if (!existingBranches.data.some((branch) => branch.name === branchName)) {
        await createBranch(auth, dbRepo.projectId, branchName, dbRepo.defaultBranch).catch((createError) => {
          const message = createError instanceof Error ? createError.message : String(createError);
          if (!/branch already exists/i.test(message)) throw createError;
        });
      }

      await commitMultipleFiles(auth, dbRepo.projectId, branchName, "Custom Model update via SimpleMDG Tool Studio", actions);

      const compare = await compareBranches(auth, dbRepo.projectId, dbRepo.defaultBranch, branchName);
      if (!compare.diffs.length) {
        await deleteBranch(auth, dbRepo.projectId, branchName).catch(() => undefined);
        sendJson(res, { noChange: true, warnings });
        return true;
      }

      const mergeRequest = await createMergeRequest(auth, dbRepo.projectId, {
        sourceBranch: branchName,
        targetBranch: dbRepo.defaultBranch,
        title: `[${dbRepo.pathWithNamespace.split("/").pop()}][${dbRepo.defaultBranch}] Custom Model update ${dateSuffix}`,
        description: "Automated Custom Model (custom-model.cds) update via SimpleMDG Tool Studio.",
      });

      sendJson(res, {
        mergeRequest: { pathWithNamespace: dbRepo.pathWithNamespace, webUrl: mergeRequest.web_url, iid: mergeRequest.iid, projectId: dbRepo.projectId, targetBranch: dbRepo.defaultBranch },
        warnings,
      });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
