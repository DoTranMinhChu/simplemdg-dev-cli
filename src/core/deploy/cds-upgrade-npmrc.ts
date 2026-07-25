import { readCache } from "../cache";
import { resolveRegistryProjectId } from "../npmrc/npmrc-project-resolver";
import { writeNpmrcFile, normalizeGitLabHost } from "../npmrc";
import type { TGitLabAuth, TGitLabGroup } from "../gitlab/gitlab-client";

/**
 * Real master-data repos depend on `@scope/*` packages published on a GitLab
 * project's own npm package registry (confirmed with the user) — `npm
 * install` 404s/401s on them without a `.npmrc` carrying the registry URL +
 * auth token. Reuses the SAME storage this repo's existing `smdg npmrc`
 * feature already maintains (`~/.simplemdg/cache.json`'s `npmrc` block) —
 * this does not introduce a second credential store.
 */

export type TResolvedNpmrcAuth = { host: string; packageId: string; token: string };

/** Resolves the npm registry (GitLab project ID hosting the package registry) + a matching auth token for `scope`, from what `smdg npmrc` has already configured for this group. `undefined` when either piece is missing — the caller decides how to report that (a repo that doesn't actually need this scope should never be blocked on it). */
export async function resolveNpmrcAuthForGroup(auth: TGitLabAuth, group: TGitLabGroup, scope: string): Promise<TResolvedNpmrcAuth | undefined> {
  const host = normalizeGitLabHost(auth.baseUrl);
  const { packageId } = await resolveRegistryProjectId(auth, group);
  if (!packageId) return undefined;

  const cache = await readCache();
  // Same fallback order as `askToken` in npmrc.command.ts's non-interactive path: an exact
  // host+scope match first, then any token registered for this scope (a repo's own scope is what
  // matters — the host is almost always the same GitLab instance anyway).
  const token =
    cache.npmrc.tokenEntries.find((entry) => entry.host === host && entry.scope === scope)?.token ??
    cache.npmrc.tokenEntries.find((entry) => entry.scope === scope)?.token;
  if (!token) return undefined;

  return { host, packageId, token };
}

/**
 * Writes the resolved registry+token to `npmrcPath` — a location OUTSIDE any git working tree (see
 * `cds-upgrade-install.ts`'s `runNpmInstall`, which points `NPM_CONFIG_USERCONFIG` at this same
 * path) so the token can never end up inside `git add -A`'s reach.
 */
export async function writeScopedNpmrc(npmrcPath: string, resolved: TResolvedNpmrcAuth, scope: string): Promise<void> {
  await writeNpmrcFile({
    host: resolved.host,
    scope,
    packageId: resolved.packageId,
    token: resolved.token,
    outputFileName: npmrcPath,
    alwaysAuth: true,
  });
}
