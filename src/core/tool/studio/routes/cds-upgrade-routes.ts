import http from "node:http";
import crypto from "node:crypto";
import { getString, readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { getDefaultGitLabAuth, listProjects } from "../../../gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup } from "../../../gitlab/gitlab-client";
import { discoverObjectTypesForGroup } from "../../../deploy/object-type-discovery";
import { findDeployTarget, listManualObjectTypes, mergeObjectTypesWithManual } from "../../../deploy/deploy-target-store";
import { previewCdsUpgrade, runCdsUpgradeJob } from "../../../deploy/cds-upgrade-job";
import type { TCdsUpgradeRepoInput } from "../../../deploy/cds-upgrade-job";

function groupFromTarget(target: { gitlabGroupId: number; gitlabGroupPath: string }): TGitLabGroup {
  return { id: target.gitlabGroupId, full_path: target.gitlabGroupPath, name: target.gitlabGroupPath.split("/").pop() ?? target.gitlabGroupPath };
}

/**
 * Every db/srv/srv_process repo discovered for this deploy target's GitLab group (all roles — the
 * user explicitly wants the upgrade applied across all three, not just db), joined with each
 * project's real clone URL — `discoverObjectTypesForGroup` classifies role from `_laidonBuild.yaml`
 * alone (no clone needed) but doesn't carry `http_url_to_repo`, which the upgrade job needs for its
 * real local clone. Deduped by projectId (an object type can list the same repo under more than one
 * discovered entry in edge cases, e.g. shared F4 repo).
 */
async function resolveCandidateRepos(auth: TGitLabAuth, target: { gitlabBaseUrl: string; gitlabGroupId: number; gitlabGroupPath: string; defaultBranch: string }): Promise<TCdsUpgradeRepoInput[]> {
  const group = groupFromTarget(target);
  const [discovered, manual, projects] = await Promise.all([
    discoverObjectTypesForGroup(auth, group, { preferredBranch: target.defaultBranch }),
    listManualObjectTypes(`${auth.baseUrl}::${group.id}`),
    listProjects(auth, group, false),
  ]);

  const projectById = new Map(projects.data.map((project) => [project.id, project]));
  const byProjectId = new Map<number, TCdsUpgradeRepoInput>();

  for (const objectType of mergeObjectTypesWithManual(discovered.data, manual)) {
    for (const repo of objectType.repos) {
      if (byProjectId.has(repo.projectId)) continue;
      const project = projectById.get(repo.projectId);
      if (!project) continue; // repo no longer in the group / not returned by listProjects — skip rather than guess a clone URL
      byProjectId.set(repo.projectId, { ...repo, httpUrlToRepo: project.http_url_to_repo });
    }
  }

  return Array.from(byProjectId.values()).sort((a, b) => a.pathWithNamespace.localeCompare(b.pathWithNamespace));
}

export async function handleCdsUpgradeApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/cds-upgrade/candidate-repos" && method === "GET") {
    const deployTargetId = url.searchParams.get("deployTargetId") ?? "";
    const target = await findDeployTarget(deployTargetId);
    const auth = await getDefaultGitLabAuth();
    if (!target || !auth) {
      sendJson(res, { repos: [], error: !target ? "Deploy target not found" : "Not logged in to GitLab. Run: smdg gitlab login" }, target ? 401 : 404);
      return true;
    }
    try {
      sendJson(res, { repos: await resolveCandidateRepos(auth, target) });
    } catch (error) {
      sendJson(res, { repos: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cds-upgrade/preview" && method === "POST") {
    const body = await readJsonBody(req);
    const target = await findDeployTarget(getString(body, "deployTargetId"));
    const auth = await getDefaultGitLabAuth();
    const sourceBranch = getString(body, "sourceBranch");
    const targetVersion = getString(body, "targetVersion");
    if (!target || !auth) {
      sendJson(res, { error: !target ? "Deploy target not found" : "Not logged in to GitLab" }, 400);
      return true;
    }
    if (!sourceBranch || !targetVersion) {
      sendJson(res, { error: "sourceBranch and targetVersion are required" }, 400);
      return true;
    }
    try {
      const repos = await resolveCandidateRepos(auth, target);
      const rows = await previewCdsUpgrade(auth, sourceBranch, targetVersion, repos);
      sendJson(res, { rows });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (url.pathname === "/api/tool/cds-upgrade/run" && method === "POST") {
    const body = await readJsonBody(req);
    const target = await findDeployTarget(getString(body, "deployTargetId"));
    const auth = await getDefaultGitLabAuth();
    const sourceBranch = getString(body, "sourceBranch");
    const targetVersion = getString(body, "targetVersion");
    if (!target || !auth) {
      sendJson(res, { error: !target ? "Deploy target not found" : "Not logged in to GitLab" }, 400);
      return true;
    }
    if (!sourceBranch || !targetVersion) {
      sendJson(res, { error: "sourceBranch and targetVersion are required" }, 400);
      return true;
    }

    try {
      const repos = await resolveCandidateRepos(auth, target);
      const jobId = crypto.randomUUID();
      // Respond immediately with the jobId; progress streams over /api/tool/events (channel:"job").
      sendJson(res, { jobId });
      void runCdsUpgradeJob(jobId, { auth, group: groupFromTarget(target), sourceBranch, targetVersion, repos }).catch(() => undefined);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
