import { smartRead, DEFAULT_CACHE_TTL } from "../cache/smart-cache";
import type { TSmartCacheResult } from "../cache/smart-cache.types";
import { mapWithConcurrency } from "../concurrency";
import { fetchRawFile, fetchRepositoryTree, listProjects, normalizeBaseUrl } from "../gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup } from "../gitlab/gitlab-client";

export type TCdsServiceInfo = {
  name: string;
  /** OData path this service is mounted at — from an explicit `@path` annotation when present, else `/<name>` (CAP's own default). */
  path: string;
  sourceFile: string;
};

export type TResolvedAppServices = {
  matched: boolean;
  pathWithNamespace?: string;
  defaultBranch?: string;
  services: TCdsServiceInfo[];
  /** Set when a repo WAS matched but scanning its `.cds` files failed (network/GitLab error) — an
   * empty `services` array with this unset means "scanned fine, found nothing", which the UI needs
   * to tell apart from "couldn't scan it at all". */
  scanError?: string;
};

/** A repo's `.cds` files fan out to one raw-file fetch each — bounded so a repo with many service
 * files doesn't burst into dozens of simultaneous GitLab connections. */
const FILE_FETCH_CONCURRENCY = 4;

const SERVICE_DECL_RE = /^\s*service\s+([A-Za-z_][\w.]*)/;
const PATH_ANNOTATION_RE = /@(?:path\s*:\s*|\(\s*path\s*:\s*)['"]([^'"]+)['"]/;

/**
 * Line-scans (not a full CDS compiler — deliberately, since we only have raw-file access over the
 * GitLab API, not a checked-out repo to run the real `cds` compiler against) a `.cds` file's source
 * for `service <Name>` declarations, pairing each with the nearest preceding `@path` annotation
 * (whether written as its own line above the declaration or inline after the service name) — this
 * matches every real pattern confirmed across a customer's actual srv repos, where every service
 * declares an explicit `@path` matching its own name. Falls back to `/<Name>` (CAP's own default
 * mount path) when no annotation is found, so an unusual repo still yields a usable guess.
 */
export function parseCdsServices(source: string, sourceFile: string): TCdsServiceInfo[] {
  const results: TCdsServiceInfo[] = [];
  let pendingPath: string | undefined;

  for (const line of source.split(/\r?\n/)) {
    const serviceMatch = line.match(SERVICE_DECL_RE);
    if (!serviceMatch) {
      const pathMatch = line.match(PATH_ANNOTATION_RE);
      if (pathMatch) pendingPath = pathMatch[1];
      continue;
    }

    const inlinePathMatch = line.match(PATH_ANNOTATION_RE);
    const path = inlinePathMatch?.[1] ?? pendingPath ?? `/${serviceMatch[1]}`;
    results.push({ name: serviceMatch[1], path, sourceFile });
    pendingPath = undefined;
  }

  return results;
}

async function discoverCdsServicesForRepo(auth: TGitLabAuth, projectId: number, branch: string): Promise<TCdsServiceInfo[]> {
  const tree = await fetchRepositoryTree(auth, projectId, "srv", branch, { recursive: true });
  const cdsFiles = tree.filter((entry) => entry.type === "blob" && entry.path.endsWith(".cds"));

  const perFile = await mapWithConcurrency(cdsFiles, FILE_FETCH_CONCURRENCY, async (file) => {
    const raw = await fetchRawFile(auth, projectId, file.path, branch);
    return raw ? parseCdsServices(raw, file.path) : [];
  });

  const byName = new Map<string, TCdsServiceInfo>();
  for (const service of perFile.flat()) byName.set(service.name, service);
  return Array.from(byName.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function buildAppKey(auth: TGitLabAuth, group: TGitLabGroup, liveAppName: string): string {
  return `${normalizeBaseUrl(auth.baseUrl)}::${group.id}::${liveAppName.toLowerCase()}`;
}

async function resolveAndScan(auth: TGitLabAuth, group: TGitLabGroup, liveAppName: string): Promise<TResolvedAppServices> {
  // CF app names are always the repo's own name with underscores hyphenated (confirmed against a
  // real customer checkout: `_laidonBuild.yaml`'s `build.flow.name` is set to exactly that
  // transform of the repo's own folder name in every sample checked — never an arbitrary rename).
  // Reversing it locates the one GitLab repo behind a live app WITHOUT needing to fetch
  // `_laidonBuild.yaml` (or scan CDS files) for every other repo in the group — `listProjects` is
  // the only GitLab call this makes for repos that don't end up matching, and it's already
  // smart-cached group-wide, so repeated lookups across different apps in the same group are cheap.
  const candidateRepoName = liveAppName.replace(/-/g, "_").toLowerCase();
  const projectsResult = await listProjects(auth, group, false);
  const project = projectsResult.data.find((item) => item.name.toLowerCase() === candidateRepoName);
  if (!project) return { matched: false, services: [] };

  const branch = project.default_branch || "main";
  try {
    const services = await discoverCdsServicesForRepo(auth, project.id, branch);
    return { matched: true, pathWithNamespace: project.path_with_namespace, defaultBranch: branch, services };
  } catch (error) {
    return { matched: true, pathWithNamespace: project.path_with_namespace, defaultBranch: branch, services: [], scanError: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Resolve which CDS services (name + OData path) a LIVE CF app exposes, by matching it back to its
 * GitLab repo and scanning that one repo's `srv/*.cds` files — deliberately lazy (called only once
 * a user picks a specific app from a live `cf apps` listing, see check-api-routes.ts), not an
 * eager bulk scan of every `_srv_*` repo in the group. That eager approach was tried first and
 * caused two real problems: it surfaced repos that were never actually deployed (confusing a "45
 * repos found" GitLab count with what a customer's BTP cockpit actually shows running), and firing
 * dozens of repos' worth of GitLab calls at once got silently throttled. Scoping the scan to one
 * already-known-live app avoids both.
 */
export async function resolveServicesForLiveApp(auth: TGitLabAuth, group: TGitLabGroup, liveAppName: string, options?: { refresh?: boolean }): Promise<TSmartCacheResult<TResolvedAppServices>> {
  return smartRead<TResolvedAppServices>({
    namespace: "srv-app-services",
    key: buildAppKey(auth, group, liveAppName),
    ttlMs: DEFAULT_CACHE_TTL.srvAppServices,
    mode: options?.refresh ? "network-only" : "stale-while-revalidate",
    fetcher: () => resolveAndScan(auth, group, liveAppName),
  });
}
