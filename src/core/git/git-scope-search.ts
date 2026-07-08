import { runGit, runGitSilent } from "./git-command";
import { commitExists } from "./git-repository";
import type { TGitCandidateCommit, TGitCommitSource, TGitLogRange } from "./git-types";

const FIELD_SEP = "\x1f";
const LOG_FORMAT = `%H${FIELD_SEP}%P${FIELD_SEP}%s`;

export function qualifiedRange(range: TGitLogRange): string {
  return `origin/${range.target}..origin/${range.source}`;
}

function parseLogLines(output: string, source: TGitCommitSource): TGitCandidateCommit[] {
  const commits: TGitCandidateCommit[] = [];

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [hash, parentsRaw, subject] = line.split(FIELD_SEP);
    if (!hash) continue;
    const parents = (parentsRaw ?? "").split(" ").filter(Boolean);

    commits.push({
      hash,
      shortHash: hash.slice(0, 7),
      subject: subject ?? "",
      parents,
      kind: parents.length > 1 ? "merge" : "normal",
      source,
    });
  }

  return commits;
}

/** `git log origin/<target>..origin/<source> --grep=<keyword>` — commits touching a ticket/feature/keyword. */
export async function searchCommitsByKeyword(cwd: string, range: TGitLogRange, keyword: string): Promise<TGitCandidateCommit[]> {
  const result = await runGit([
    "log",
    qualifiedRange(range),
    `--pretty=format:${LOG_FORMAT}`,
    "-i",
    `--grep=${keyword}`,
  ], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git log --grep failed: ${(result.stderr || result.stdout).trim()}`);
  }

  return parseLogLines(result.stdout, "grep");
}

/** `git log origin/<target>..origin/<source> -- <path>` — commits touching a file or folder path. */
export async function searchCommitsByPath(cwd: string, range: TGitLogRange, pathSpec: string): Promise<TGitCandidateCommit[]> {
  const result = await runGit([
    "log",
    qualifiedRange(range),
    `--pretty=format:${LOG_FORMAT}`,
    "--",
    pathSpec,
  ], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git log -- <path> failed: ${(result.stderr || result.stdout).trim()}`);
  }

  return parseLogLines(result.stdout, "path");
}

/** `git grep -l "<symbol>" origin/<source>` — files on the source branch containing a symbol. */
export async function searchFilesBySymbol(cwd: string, source: string, symbol: string): Promise<string[]> {
  const ref = `origin/${source}`;
  const result = await runGit(["grep", "-l", "-I", "-F", symbol, ref], { cwd });

  if (result.exitCode === 1 && !result.stdout.trim()) {
    // Exit code 1 with no output means "no matches" for git grep — not an error.
    return [];
  }

  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`git grep failed: ${(result.stderr || result.stdout).trim()}`);
  }

  const prefix = `${ref}:`;
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line));
}

/** Symbol search: find files containing the symbol on the source branch, then log those files in-range. */
export async function searchCommitsBySymbol(
  cwd: string,
  range: TGitLogRange,
  symbol: string,
): Promise<{ files: string[]; commits: TGitCandidateCommit[] }> {
  const files = await searchFilesBySymbol(cwd, range.source, symbol);

  if (!files.length) {
    return { files, commits: [] };
  }

  const result = await runGit([
    "log",
    qualifiedRange(range),
    `--pretty=format:${LOG_FORMAT}`,
    "--",
    ...files,
  ], { cwd });

  if (result.exitCode !== 0) {
    throw new Error(`git log -- <files> failed: ${(result.stderr || result.stdout).trim()}`);
  }

  return { files, commits: parseLogLines(result.stdout, "symbol").map((commit) => ({ ...commit, source: "symbol" as const })) };
}

/** Manual commit hash entry: validate it exists and is actually reachable from the source branch. */
export async function resolveManualCommit(cwd: string, range: TGitLogRange, hash: string): Promise<TGitCandidateCommit> {
  if (!(await commitExists(cwd, hash))) {
    throw new Error(`Commit not found: ${hash}`);
  }

  const inRange = await runGitSilent(["merge-base", "--is-ancestor", hash, `origin/${range.source}`], cwd);
  if (inRange.exitCode !== 0) {
    throw new Error(`Commit ${hash} is not an ancestor of origin/${range.source}.`);
  }

  const show = await runGitSilent(["show", "--no-patch", `--pretty=format:${LOG_FORMAT}`, hash], cwd);
  if (show.exitCode !== 0) {
    throw new Error(`Cannot read commit ${hash}: ${(show.stderr || show.stdout).trim()}`);
  }

  const [commit] = parseLogLines(show.stdout, "manual");
  if (!commit) {
    throw new Error(`Cannot parse commit ${hash}.`);
  }

  return commit;
}

/** De-duplicate candidate commits by hash, preserving first-seen order. */
export function dedupeCommits(commits: TGitCandidateCommit[]): TGitCandidateCommit[] {
  const seen = new Set<string>();
  const result: TGitCandidateCommit[] = [];

  for (const commit of commits) {
    if (seen.has(commit.hash)) continue;
    seen.add(commit.hash);
    result.push(commit);
  }

  return result;
}
