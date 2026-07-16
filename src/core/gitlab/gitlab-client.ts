import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { smartRead, buildGitLabGroupsKey, buildGitLabProjectsKey, DEFAULT_CACHE_TTL } from "../cache/smart-cache";
import type { TSmartCacheResult } from "../cache/smart-cache.types";
import { encryptSecret, decryptSecret } from "../db/db-crypto";

const GITLAB_CACHE_DIR = path.join(os.homedir(), ".simplemdg");
const GITLAB_CACHE_FILE = path.join(GITLAB_CACHE_DIR, "gitlab.json");

/**
 * In-memory shape always carries the plaintext token (needed to build request
 * headers); only the on-disk cache file stores it encrypted (see
 * readGitLabCache/writeGitLabCache below) — mirrors how CF passwords are
 * handled in cf-auth-service.ts, unlike the token's previous plaintext storage.
 */
export type TGitLabAuth = {
  baseUrl: string;
  token: string;
  username?: string;
  name?: string;
  expiresAt?: string | null;
  updatedAt: string;
};

export type TGitLabCache = {
  instances: TGitLabAuth[];
  groupsByBaseUrl: Record<string, { updatedAt: string; groups: TGitLabGroup[] }>;
  projectsByGroup: Record<string, { updatedAt: string; projects: TGitLabProject[] }>;
  destinations: string[];
};

export type TGitLabGroup = {
  id: number;
  name: string;
  full_path: string;
  visibility?: string;
  parent_id?: number | null;
};

export type TGitLabProject = {
  id: number;
  name: string;
  path_with_namespace: string;
  http_url_to_repo: string;
  ssh_url_to_repo?: string;
  default_branch?: string;
  archived?: boolean;
};

function emptyGitLabCache(): TGitLabCache {
  return { instances: [], groupsByBaseUrl: {}, projectsByGroup: {}, destinations: ["."] };
}

export async function readGitLabCache(): Promise<TGitLabCache> {
  if (!(await fs.pathExists(GITLAB_CACHE_FILE))) return emptyGitLabCache();
  const value = await fs.readJson(GITLAB_CACHE_FILE).catch(() => emptyGitLabCache()) as Partial<TGitLabCache>;
  return {
    instances: (value.instances ?? []).map((instance) => ({ ...instance, token: decryptSecret(instance.token) })),
    groupsByBaseUrl: value.groupsByBaseUrl ?? {},
    projectsByGroup: value.projectsByGroup ?? {},
    destinations: value.destinations?.length ? value.destinations : ["."],
  };
}

export async function writeGitLabCache(cache: TGitLabCache): Promise<void> {
  await fs.ensureDir(GITLAB_CACHE_DIR);
  const onDisk: TGitLabCache = { ...cache, instances: cache.instances.map((instance) => ({ ...instance, token: encryptSecret(instance.token) })) };
  await fs.writeJson(GITLAB_CACHE_FILE, onDisk, { spaces: 2 });
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function makeGroupCacheKey(baseUrl: string, groupId: number): string {
  return `${normalizeBaseUrl(baseUrl)}|${groupId}`;
}

export async function gitlabFetch<T>(auth: TGitLabAuth, apiPath: string, search?: URLSearchParams): Promise<T> {
  const url = new URL(`${normalizeBaseUrl(auth.baseUrl)}/api/v4${apiPath}`);
  if (search) {
    for (const [key, value] of search.entries()) url.searchParams.set(key, value);
  }
  const response = await fetch(url, { headers: { "PRIVATE-TOKEN": auth.token } });
  if (!response.ok) throw new Error(`GitLab API failed ${response.status}: ${await response.text()}`);
  return await response.json() as T;
}

export async function gitlabFetchAll<T>(auth: TGitLabAuth, apiPath: string, search?: Record<string, string>): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  while (true) {
    const params = new URLSearchParams({ per_page: "100", page: String(page), ...(search ?? {}) });
    const chunk = await gitlabFetch<T[]>(auth, apiPath, params);
    rows.push(...chunk);
    if (chunk.length < 100) break;
    page += 1;
  }
  return rows;
}

export async function validateToken(baseUrl: string, token: string): Promise<TGitLabAuth> {
  const auth: TGitLabAuth = { baseUrl: normalizeBaseUrl(baseUrl), token, updatedAt: new Date().toISOString() };
  const user = await gitlabFetch<{ username?: string; name?: string; email?: string }>(auth, "/user");
  let expiresAt: string | null | undefined;
  try {
    const self = await gitlabFetch<{ expires_at?: string | null }>(auth, "/personal_access_tokens/self");
    expiresAt = self.expires_at;
  } catch {
    expiresAt = undefined;
  }
  return { ...auth, username: user.username, name: user.name, expiresAt };
}

export async function approveGitCredential(auth: TGitLabAuth): Promise<void> {
  const url = new URL(auth.baseUrl);
  const input = [`protocol=${url.protocol.replace(":", "")}`, `host=${url.host}`, "username=oauth2", `password=${auth.token}`, "", ""].join("\n");
  await execa("git", ["credential", "approve"], { input, reject: false });
}

export async function saveAuth(auth: TGitLabAuth): Promise<void> {
  const cache = await readGitLabCache();
  const next = [auth, ...cache.instances.filter((item) => normalizeBaseUrl(item.baseUrl) !== normalizeBaseUrl(auth.baseUrl))];
  cache.instances = next.slice(0, 20);
  await writeGitLabCache(cache);
  await approveGitCredential(auth).catch(() => undefined);
}

/** Most-recently-used GitLab login, for non-interactive (server-side) callers. Undefined if never logged in. */
export async function getDefaultGitLabAuth(): Promise<TGitLabAuth | undefined> {
  const cache = await readGitLabCache();
  return cache.instances[0];
}

/** UI-agnostic: callers (CLI command, Tool Studio routes) decide how to surface cache/refresh state. */
/**
 * Fetch a repository file's raw content (no clone required). Returns
 * `undefined` on 404 — callers treat a missing file as "not applicable" (e.g.
 * a repo without `_laidonBuild.yaml`) rather than an error.
 */
export async function fetchRawFile(auth: TGitLabAuth, projectId: number, filePath: string, ref: string): Promise<string | undefined> {
  const encodedId = encodeURIComponent(String(projectId));
  const encodedPath = encodeURIComponent(filePath);
  const url = new URL(`${normalizeBaseUrl(auth.baseUrl)}/api/v4/projects/${encodedId}/repository/files/${encodedPath}/raw`);
  url.searchParams.set("ref", ref);
  const response = await fetch(url, { headers: { "PRIVATE-TOKEN": auth.token } });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`GitLab raw file fetch failed ${response.status}: ${filePath}`);
  return await response.text();
}

export type TGitLabTreeEntry = { id: string; name: string; type: "blob" | "tree"; path: string };

/** List a repository directory's entries (no clone required). Returns `[]` on 404 (path not found). */
export async function fetchRepositoryTree(auth: TGitLabAuth, projectId: number, treePath: string, ref: string): Promise<TGitLabTreeEntry[]> {
  const encodedId = encodeURIComponent(String(projectId));
  const url = new URL(`${normalizeBaseUrl(auth.baseUrl)}/api/v4/projects/${encodedId}/repository/tree`);
  url.searchParams.set("path", treePath);
  url.searchParams.set("ref", ref);
  const response = await fetch(url, { headers: { "PRIVATE-TOKEN": auth.token } });
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`GitLab repository tree fetch failed ${response.status}: ${treePath}`);
  return await response.json() as TGitLabTreeEntry[];
}

export async function listRootGroups(auth: TGitLabAuth, refresh: boolean): Promise<TSmartCacheResult<TGitLabGroup[]>> {
  return smartRead<TGitLabGroup[]>({
    namespace: "gitlab-groups",
    key: buildGitLabGroupsKey(auth.baseUrl, auth.username),
    ttlMs: DEFAULT_CACHE_TTL.gitlabGroups,
    mode: refresh ? "network-only" : "stale-while-revalidate",
    // `min_access_level` + `all_available=false` together return ZERO groups on at least one real
    // GitLab instance (confirmed empirically: 0 vs 76 real top-level groups for the same account
    // with only `top_level_only` set) — dropping both is a no-op for a normal user (GitLab already
    // only returns groups you have access to) and actually lists the groups you belong to.
    fetcher: () => gitlabFetchAll<TGitLabGroup>(auth, "/groups", { top_level_only: "true", order_by: "name", sort: "asc" }),
  });
}

/** UI-agnostic: callers (CLI command, Tool Studio routes) decide how to surface cache/refresh state. */
export async function listProjects(auth: TGitLabAuth, group: TGitLabGroup, refresh: boolean): Promise<TSmartCacheResult<TGitLabProject[]>> {
  const encodedId = encodeURIComponent(String(group.id));
  return smartRead<TGitLabProject[]>({
    namespace: "gitlab-projects",
    key: buildGitLabProjectsKey(auth.baseUrl, group.id),
    ttlMs: DEFAULT_CACHE_TTL.gitlabProjects,
    mode: refresh ? "network-only" : "stale-while-revalidate",
    fetcher: () => gitlabFetchAll<TGitLabProject>(auth, `/groups/${encodedId}/projects`, { include_subgroups: "true", archived: "false", order_by: "path", sort: "asc" }),
  });
}
