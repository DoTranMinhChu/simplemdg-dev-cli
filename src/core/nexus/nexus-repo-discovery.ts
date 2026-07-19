import path from "node:path";
import fg from "fast-glob";

export type TDiscoveredRepo = {
  path: string;
  name: string;
};

/**
 * Walk a folder for nested git repositories (the reference SAP MDG products
 * this feature targets can have hundreds of independently-git-initialized
 * folders under one parent, e.g. `be-group/master-data/<entity>/simplemdg_db_x`
 * — there is never a single top-level repo to just "add"). Bounded depth and
 * `node_modules`/`dist` exclusion keep this fast even under a large tree.
 */
export async function discoverGitRepositories(rootFolder: string, options?: { maxDepth?: number }): Promise<TDiscoveredRepo[]> {
  const maxDepth = options?.maxDepth ?? 8;

  const gitDirs = await fg("**/.git", {
    cwd: rootFolder,
    onlyDirectories: true,
    deep: maxDepth,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"],
    dot: true,
    absolute: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  });

  return gitDirs
    .map((gitDir) => path.dirname(gitDir))
    .sort((a, b) => a.localeCompare(b))
    .map((repoPath) => ({ path: repoPath, name: path.basename(repoPath) }));
}
