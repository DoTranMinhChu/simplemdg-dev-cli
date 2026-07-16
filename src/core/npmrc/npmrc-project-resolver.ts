import { readCache, pinNpmrcPackageId, unpinNpmrcPackageId } from "../cache";
import { listProjects } from "../gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup, TGitLabProject } from "../gitlab/gitlab-client";

export type TResolvedRegistryProject = {
  packageId: string | undefined;
  source: "manual" | "auto" | "none";
  candidateProjects: TGitLabProject[];
};

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Best-guess the GitLab project whose numeric ID should back the group's
 * `@scope` npm registry (`.npmrc` generation) — replacing the old tool's
 * hand-maintained `package-id.json` map. A manual pin (set via the UI)
 * always wins and survives a future re-scan of the group's projects.
 */
export async function resolveRegistryProjectId(auth: TGitLabAuth, group: TGitLabGroup): Promise<TResolvedRegistryProject> {
  const cache = await readCache();
  const projectKey = group.full_path;
  const pinned = cache.npmrc.packageIdsByProject[projectKey]?.pinnedPackageId;

  const result = await listProjects(auth, group, false);
  const candidateProjects = result.data;

  if (pinned) {
    return { packageId: pinned, source: "manual", candidateProjects };
  }

  if (!candidateProjects.length) {
    return { packageId: undefined, source: "none", candidateProjects };
  }

  const groupSlug = slugify(group.name);
  const bestGuess =
    candidateProjects.find((project) => slugify(project.name) === groupSlug) ??
    candidateProjects.find((project) => project.path_with_namespace.toLowerCase() === group.full_path.toLowerCase()) ??
    candidateProjects[0];

  return { packageId: String(bestGuess.id), source: "auto", candidateProjects };
}

export async function pinRegistryProjectId(group: TGitLabGroup, packageId: string): Promise<void> {
  await pinNpmrcPackageId(group.full_path, packageId);
}

export async function clearPinnedRegistryProjectId(group: TGitLabGroup): Promise<void> {
  await unpinNpmrcPackageId(group.full_path);
}
