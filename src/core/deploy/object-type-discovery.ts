import { parse as parseYaml } from "yaml";
import { smartRead, DEFAULT_CACHE_TTL } from "../cache/smart-cache";
import type { TSmartCacheResult } from "../cache/smart-cache.types";
import { fetchRawFile, fetchRepositoryTree, listProjects, normalizeBaseUrl } from "../gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup, TGitLabProject } from "../gitlab/gitlab-client";

export type TObjectTypeRepoRole = "db" | "srv" | "srv_process" | "unknown";
export type TCdsVersion = "cds6" | "cds7" | "cds8";

export type TObjectTypeRepoRef = {
  projectId: number;
  pathWithNamespace: string;
  role: TObjectTypeRepoRole;
  defaultBranch: string;
};

export type TDiscoveredObjectType = {
  slug: string;
  envObjectName: string;
  repos: TObjectTypeRepoRef[];
  source: "laidonBuild" | "manual";
};

export type TObjectTypeDefaultsSuggestion = {
  cdsVersion?: TCdsVersion;
  isConsolidation?: boolean;
};

type TLaidonBuildFile = {
  build?: { flow?: { objecttype?: string; envObject?: string } };
};

/**
 * `_laidonBuild.yaml`'s repo-name convention (`simplemdg_(db|srv|srv_process)_<code>`) is used
 * ONLY as a secondary signal to label a repo's role within an already-discovered object type —
 * research on real customer repos showed several customers have empty stub repos that would be
 * miscounted as real object types if role/existence were inferred from naming alone. The primary
 * signal is always the file's own `build.flow.objecttype`/`envObject` content.
 */
function classifyRepoRole(project: TGitLabProject): TObjectTypeRepoRole {
  const haystack = `${project.path_with_namespace} ${project.name}`.toLowerCase();
  if (haystack.includes("process")) return "srv_process";
  if (haystack.includes("srv")) return "srv";
  if (haystack.includes("db")) return "db";
  return "unknown";
}

function buildGroupKey(auth: TGitLabAuth, group: TGitLabGroup): string {
  return `${normalizeBaseUrl(auth.baseUrl)}::${group.id}`;
}

/**
 * F4 (value-help) deploys don't target a per-object-type srv/srv_process pair like every other
 * object type — the legacy tool always targeted ONE shared, db-only, cross-customer-named repo
 * (`simplemdg_db_f4`), consumed as an external dependency (`@simplemdg/db_f4`) by every other
 * object type's own srv repo. Confirmed against the legacy tool's `F4_MODEL_REPO` constant and a
 * real customer checkout (`be-group/core/common/simplemdg_db_f4`, containing only
 * `db/external/MDG_F4.{csn,xml}` — no srv counterpart exists). This is looked up as a special
 * repo, not discovered via `_laidonBuild.yaml` like ordinary object types.
 */
const F4_MODEL_REPO_NAME = "simplemdg_db_f4";

function findRepoByExactName(projects: TGitLabProject[], repoName: string): TGitLabProject | undefined {
  return projects.find((project) => {
    const lastSegment = project.path_with_namespace.split("/").pop() ?? project.path_with_namespace;
    return lastSegment.toLowerCase() === repoName || project.name.toLowerCase() === repoName;
  });
}

async function scanGroupForObjectTypes(auth: TGitLabAuth, group: TGitLabGroup): Promise<TDiscoveredObjectType[]> {
  const projectsResult = await listProjects(auth, group, false);
  const bySlug = new Map<string, TDiscoveredObjectType>();

  await Promise.all(
    projectsResult.data.map(async (project) => {
      const ref = project.default_branch || "main";
      const raw = await fetchRawFile(auth, project.id, "_laidonBuild.yaml", ref).catch(() => undefined);
      if (!raw) return;

      let parsed: TLaidonBuildFile | undefined;
      try {
        parsed = parseYaml(raw) as TLaidonBuildFile;
      } catch {
        return;
      }

      const slug = parsed?.build?.flow?.objecttype?.trim();
      if (!slug) return;
      const envObjectName = parsed?.build?.flow?.envObject?.trim() || slug;

      const existing = bySlug.get(slug) ?? { slug, envObjectName, repos: [], source: "laidonBuild" as const };
      existing.repos.push({ projectId: project.id, pathWithNamespace: project.path_with_namespace, role: classifyRepoRole(project), defaultBranch: ref });
      bySlug.set(slug, existing);
    }),
  );

  if (!bySlug.has("f4")) {
    const f4Repo = findRepoByExactName(projectsResult.data, F4_MODEL_REPO_NAME);
    if (f4Repo) {
      bySlug.set("f4", {
        slug: "f4",
        envObjectName: "F4 (Value Help)",
        source: "laidonBuild",
        repos: [{ projectId: f4Repo.id, pathWithNamespace: f4Repo.path_with_namespace, role: "db", defaultBranch: f4Repo.default_branch || "main" }],
      });
    }
  }

  return Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Discover MDG object types for a GitLab group by scanning each repo's
 * `_laidonBuild.yaml` via the GitLab API directly — no local clone required.
 * Cached per group (TTL-based, background-refreshable like the rest of the
 * GitLab caches) since a full group scan touches every repo in the group.
 */
export async function discoverObjectTypesForGroup(auth: TGitLabAuth, group: TGitLabGroup, options?: { refresh?: boolean }): Promise<TSmartCacheResult<TDiscoveredObjectType[]>> {
  return smartRead<TDiscoveredObjectType[]>({
    namespace: "object-type-discovery",
    key: buildGroupKey(auth, group),
    ttlMs: DEFAULT_CACHE_TTL.objectTypeDiscovery,
    mode: options?.refresh ? "network-only" : "stale-while-revalidate",
    fetcher: () => scanGroupForObjectTypes(auth, group),
  });
}

function bucketCdsVersion(versionRange: string | undefined): TCdsVersion | undefined {
  const match = versionRange?.match(/(\d+)/);
  if (!match) return undefined;
  const major = Number(match[1]);
  if (major <= 6) return "cds6";
  if (major === 7) return "cds7";
  return "cds8"; // 8 and above (cds8 covers cds8+cds9, per the legacy tool's own convention)
}

async function computeObjectTypeDefaults(auth: TGitLabAuth, dbRepoProjectId: number, branch: string): Promise<TObjectTypeDefaultsSuggestion> {
  const [packageJsonRaw, dbTree] = await Promise.all([
    fetchRawFile(auth, dbRepoProjectId, "package.json", branch).catch(() => undefined),
    fetchRepositoryTree(auth, dbRepoProjectId, "db", branch).catch(() => []),
  ]);

  let cdsVersion: TCdsVersion | undefined;
  if (packageJsonRaw) {
    try {
      const packageJson = JSON.parse(packageJsonRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      cdsVersion = bucketCdsVersion(packageJson.dependencies?.["@sap/cds"] ?? packageJson.devDependencies?.["@sap/cds"]);
    } catch {
      cdsVersion = undefined;
    }
  }

  const consolidationSignalNames = new Set(["consolidate-model.cds", "cons", "final", "clone_final"]);
  const isConsolidation = dbTree.some((entry) => consolidationSignalNames.has(entry.name));

  return { cdsVersion, isConsolidation };
}

/**
 * Suggest `cdsVersion`/`isConsolidation` defaults for one object type's db repo.
 * Deliberately lazy (only called when a user opens that object type's settings
 * panel) since it costs two extra API calls per object type, unlike the cheap
 * per-repo `_laidonBuild.yaml` fetch that discovery itself does.
 */
export async function suggestObjectTypeDefaults(auth: TGitLabAuth, dbRepoProjectId: number, branch: string, options?: { refresh?: boolean }): Promise<TSmartCacheResult<TObjectTypeDefaultsSuggestion>> {
  return smartRead<TObjectTypeDefaultsSuggestion>({
    namespace: "object-type-suggestions",
    key: `${dbRepoProjectId}::${branch}`,
    ttlMs: DEFAULT_CACHE_TTL.objectTypeSuggestions,
    mode: options?.refresh ? "network-only" : "stale-while-revalidate",
    fetcher: () => computeObjectTypeDefaults(auth, dbRepoProjectId, branch),
  });
}
