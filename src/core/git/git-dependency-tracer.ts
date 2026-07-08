import path from "node:path";
import { runGitOrThrow } from "./git-command";
import { fileExistsAtRef } from "./git-repository";
import { searchCommitsByPath, searchFilesBySymbol } from "./git-scope-search";
import type { TBuildIssue, TGitCandidateCommit, TGitLogRange } from "./git-types";

const MISSING_MODULE_TS_PATTERN = /^(.*?):\d+:\d+\s*-\s*error\s+TS\d+:\s*Cannot find module ['"]([^'"]+)['"]/gm;
const MISSING_MODULE_GENERIC_PATTERN = /Cannot find module ['"]([^'"]+)['"]/g;
const PRIVATE_PROPERTY_PATTERN = /Property ['"]?(\w+)['"]? is private/g;
const MISSING_MEMBER_PATTERN = /['"](\w+)['"] does not exist (?:in|on) type ['"]([^'"]+)['"]/g;

/**
 * Parse a build/test command's combined output for known TypeScript/CAP
 * build-error shapes and turn them into actionable dependency-tracing issues.
 */
export function parseBuildErrors(output: string): TBuildIssue[] {
  const issues: TBuildIssue[] = [];
  const seen = new Set<string>();

  for (const match of output.matchAll(MISSING_MODULE_TS_PATTERN)) {
    const [, importerFile, importPath] = match;
    const key = `missing-module:${importPath}:${importerFile}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ kind: "missing-module", importPath, importerFile, candidateFiles: [] });
  }

  for (const match of output.matchAll(MISSING_MODULE_GENERIC_PATTERN)) {
    const [, importPath] = match;
    const key = `missing-module:${importPath}:`;
    if (seen.has(key) || [...seen].some((existing) => existing.startsWith(`missing-module:${importPath}:`))) continue;
    seen.add(key);
    issues.push({ kind: "missing-module", importPath, candidateFiles: [] });
  }

  for (const match of output.matchAll(PRIVATE_PROPERTY_PATTERN)) {
    const [full, symbol] = match;
    const key = `type:${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ kind: "type-mismatch", symbol, message: full, candidateFiles: [] });
  }

  for (const match of output.matchAll(MISSING_MEMBER_PATTERN)) {
    const [full, member, typeName] = match;
    const key = `type:${member}:${typeName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ kind: "type-mismatch", symbol: typeName, message: full, candidateFiles: [] });
    issues.push({ kind: "type-mismatch", symbol: member, message: full, candidateFiles: [] });
  }

  return issues;
}

const CANDIDATE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".json", "/index.ts", "/index.js"];

/**
 * Resolve a relative import path into candidate repo-relative file paths that
 * actually exist as blobs on the source branch. Never checks the local
 * filesystem — the whole point is that the file is *missing locally* but
 * present on `origin/<source>`.
 */
export async function resolveMissingModuleCandidates(
  cwd: string,
  source: string,
  issue: { importPath: string; importerFile?: string },
): Promise<string[]> {
  const ref = `origin/${source}`;
  const candidates: string[] = [];

  if (issue.importPath.startsWith(".")) {
    const baseDir = issue.importerFile ? path.posix.dirname(issue.importerFile.replace(/\\/g, "/")) : "";
    const joined = path.posix.normalize(path.posix.join(baseDir, issue.importPath));

    for (const ext of CANDIDATE_EXTENSIONS) {
      const candidate = `${joined}${ext}`;
      if (await fileExistsAtRef(cwd, ref, candidate)) {
        candidates.push(candidate);
      }
    }
  }

  if (candidates.length) {
    return candidates;
  }

  // Fall back to a basename grep across the source branch when the relative
  // path couldn't be resolved directly (e.g. importer file unknown).
  const baseName = issue.importPath.split("/").pop() ?? issue.importPath;
  const files = await searchFilesBySymbol(cwd, source, baseName);
  return files.filter((file) => path.posix.basename(file).startsWith(baseName));
}

/** Trace which source-branch commits (in range) introduced/last-touched a given file path. */
export async function findSourceCommitsForFile(cwd: string, range: TGitLogRange, filePath: string): Promise<TGitCandidateCommit[]> {
  return searchCommitsByPath(cwd, range, filePath);
}

/** Trace a type/class/interface/symbol name to the files that define/reference it, then their commits. */
export async function findSymbolSourceCommits(
  cwd: string,
  range: TGitLogRange,
  symbol: string,
): Promise<{ files: string[]; commits: TGitCandidateCommit[] }> {
  const files = await searchFilesBySymbol(cwd, range.source, symbol);

  if (!files.length) {
    return { files, commits: [] };
  }

  const commitLists = await Promise.all(files.map((file) => searchCommitsByPath(cwd, range, file)));
  const commits: TGitCandidateCommit[] = [];
  const seen = new Set<string>();

  for (const list of commitLists) {
    for (const commit of list) {
      if (seen.has(commit.hash)) continue;
      seen.add(commit.hash);
      commits.push({ ...commit, source: "dependency" });
    }
  }

  return { files, commits };
}

/** `git checkout <commit> -- <files...>` then stage them — never checks out from `origin/<source>` directly. */
export async function checkoutFilesFromCommit(cwd: string, commitHash: string, files: string[]): Promise<void> {
  if (!files.length) return;
  await runGitOrThrow(["checkout", commitHash, "--", ...files], { cwd });
  await runGitOrThrow(["add", "--", ...files], { cwd });
}

export async function commitDependencyFix(cwd: string, message: string): Promise<void> {
  await runGitOrThrow(["commit", "-m", message], { cwd });
}
