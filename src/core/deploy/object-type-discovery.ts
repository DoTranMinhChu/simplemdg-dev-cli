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
  /** The repo's real deployed CF app name, from `_laidonBuild.yaml`'s `build.flow.name` — this is
   * what a live `cf apps` listing actually shows, which is NOT simply `<space>-srv-<slug>` (confirmed
   * empirically against a real customer checkout: no `mta.yaml`/`manifest.yml` exists anywhere, CF
   * app names come straight from this field, and app routes follow CF's default per-app-name
   * behavior rather than any space-prefixed convention). Falls back to the repo's own name
   * (underscores to hyphens) when the field is missing. */
  cfAppName?: string;
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
  build?: { flow?: { objecttype?: string; envObject?: string; name?: string } };
};

/** `simplemdg_srv_bp` -> `simplemdg-srv-bp` — the literal fallback CF app name when `_laidonBuild.yaml` has no `build.flow.name` (confirmed as the real naming rule: repos declare it explicitly, but it's always just their own name with underscores hyphenated). */
function deriveCfAppNameFromRepo(project: TGitLabProject): string {
  return project.name.replace(/_/g, "-");
}

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

/**
 * Derives the object type's short business code (e.g. `"cmi"`) from its repos' own GitLab naming
 * convention (`simplemdg_db_<code>`, `simplemdg_srv_<code>`, `simplemdg_srv_<code>_process`/`_sf`).
 * Needed to reproduce the legacy tool's `MDG_<CODE>.<ObjectType>` CSN root-entity naming when
 * importing an uploaded EDMX: `cds import` derives that namespace prefix from the INPUT FILE'S OWN
 * NAME, not from anything inside the XML content, and the legacy tool always renamed the upload to
 * `MDG_<code>.xml` before running it. Confirmed against a real upload: without that rename, the
 * CSN's root prefix is just whatever the uploaded file happened to be called (e.g. `CMIR_v2` for
 * "CMIR v2.xml") — the code is NOT recoverable from the CSN content itself, only from the repo
 * names (which is also, separately, the only place a stable per-object-type namespace segment like
 * `cmi.model.final` — already used by the customer's existing `db` repo — can come from).
 */
export function deriveShortCodeFromRepos(repos: TObjectTypeRepoRef[]): string | undefined {
  const lastSegment = (repo: TObjectTypeRepoRef) => (repo.pathWithNamespace.split("/").pop() ?? repo.pathWithNamespace).toLowerCase();

  const dbRepo = repos.find((repo) => repo.role === "db");
  if (dbRepo?.pathWithNamespace) {
    const name = lastSegment(dbRepo);
    if (name.startsWith("simplemdg_db_")) return name.slice("simplemdg_db_".length);
  }

  const srvRepo = repos.find((repo) => repo.role === "srv");
  if (srvRepo) {
    const name = lastSegment(srvRepo);
    if (name.startsWith("simplemdg_srv_")) return name.slice("simplemdg_srv_".length);
  }

  const srvProcessRepo = repos.find((repo) => repo.role === "srv_process");
  if (srvProcessRepo) {
    const name = lastSegment(srvProcessRepo);
    if (name.startsWith("simplemdg_srv_")) return name.slice("simplemdg_srv_".length).replace(/_(process|sf)$/, "");
  }

  return undefined;
}

function buildGroupKey(auth: TGitLabAuth, group: TGitLabGroup, preferredBranch?: string): string {
  return `${normalizeBaseUrl(auth.baseUrl)}::${group.id}::${preferredBranch ?? ""}`;
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

/**
 * Resolves which branch to read `_laidonBuild.yaml` from (and to record as the repo's
 * `defaultBranch` for later deploys). Prefers the deploy target's own configured working branch
 * over the project's GitLab-reported default — confirmed against a real customer group where two
 * of an object type's three repos (`db`/`srv`) had their GitLab default branch repointed at a
 * `forkbk-main-*` snapshot (from some backup/restore operation) while `_laidonBuild.yaml` still
 * only existed on the real working branch (`staging`, matching the deploy target's configured
 * branch). Reading from `project.default_branch` unconditionally silently dropped both repos from
 * discovery — same failure mode a stale/rebased default branch could hit on any customer. Falls
 * back to the project's own reported default when the preferred branch doesn't have the file
 * (e.g. a repo genuinely using a different branch), so this can't regress anything that worked
 * before.
 */
async function resolveBuildYamlContent(auth: TGitLabAuth, project: TGitLabProject, preferredBranch?: string): Promise<{ ref: string; raw: string } | undefined> {
  const projectDefaultRef = project.default_branch || "main";
  const firstRef = preferredBranch || projectDefaultRef;
  const firstRaw = await fetchRawFile(auth, project.id, "_laidonBuild.yaml", firstRef).catch(() => undefined);
  if (firstRaw !== undefined) return { ref: firstRef, raw: firstRaw };

  if (firstRef === projectDefaultRef) return undefined;
  const fallbackRaw = await fetchRawFile(auth, project.id, "_laidonBuild.yaml", projectDefaultRef).catch(() => undefined);
  return fallbackRaw !== undefined ? { ref: projectDefaultRef, raw: fallbackRaw } : undefined;
}

async function scanGroupForObjectTypes(auth: TGitLabAuth, group: TGitLabGroup, preferredBranch?: string): Promise<TDiscoveredObjectType[]> {
  const projectsResult = await listProjects(auth, group, false);
  const bySlug = new Map<string, TDiscoveredObjectType>();

  await Promise.all(
    projectsResult.data.map(async (project) => {
      const found = await resolveBuildYamlContent(auth, project, preferredBranch);
      if (!found) return;

      let parsed: TLaidonBuildFile | undefined;
      try {
        parsed = parseYaml(found.raw) as TLaidonBuildFile;
      } catch {
        return;
      }

      const slug = parsed?.build?.flow?.objecttype?.trim();
      if (!slug) return;
      const envObjectName = parsed?.build?.flow?.envObject?.trim() || slug;
      const cfAppName = parsed?.build?.flow?.name?.trim() || deriveCfAppNameFromRepo(project);

      const existing = bySlug.get(slug) ?? { slug, envObjectName, repos: [], source: "laidonBuild" as const };
      existing.repos.push({ projectId: project.id, pathWithNamespace: project.path_with_namespace, role: classifyRepoRole(project), defaultBranch: found.ref, cfAppName });
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
        repos: [{ projectId: f4Repo.id, pathWithNamespace: f4Repo.path_with_namespace, role: "db", defaultBranch: preferredBranch || f4Repo.default_branch || "main", cfAppName: deriveCfAppNameFromRepo(f4Repo) }],
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
export async function discoverObjectTypesForGroup(auth: TGitLabAuth, group: TGitLabGroup, options?: { refresh?: boolean; preferredBranch?: string }): Promise<TSmartCacheResult<TDiscoveredObjectType[]>> {
  return smartRead<TDiscoveredObjectType[]>({
    namespace: "object-type-discovery",
    key: buildGroupKey(auth, group, options?.preferredBranch),
    ttlMs: DEFAULT_CACHE_TTL.objectTypeDiscovery,
    mode: options?.refresh ? "network-only" : "stale-while-revalidate",
    fetcher: () => scanGroupForObjectTypes(auth, group, options?.preferredBranch),
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
