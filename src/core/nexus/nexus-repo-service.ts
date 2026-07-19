import path from "node:path";
import { runGitSilent } from "../git/git-command";
import { getCurrentBranch } from "../git/git-repository";
import { runGitNexus, type TGitNexusCliResult } from "./gitnexus-cli-client";
import { restartGitNexusServeIfWeOwnIt } from "./gitnexus-serve-launcher";
import { serveListRepos, type TGitNexusServeRepoEntry } from "./gitnexus-serve-client";
import { parseGitNexusList, parseGitNexusStatus, type TGitNexusStatusInfo } from "./nexus-output-parser";
import { mapRepoStatus } from "./nexus-status";
import type { TNexusRepoStats, TNexusRepoSummary } from "./nexus-types";

/**
 * Normalizes a filesystem path for equality comparisons only (never for display/passing to a
 * command) — `git rev-parse --show-toplevel` reports forward slashes on Windows (`C:/Users/...`)
 * while GitNexus's own registry stores backslashes (`C:\Users\...`), and Windows paths are
 * case-insensitive. Confirmed by direct comparison during implementation; without this, a repo
 * resolved via cwd never matches its own registry entry on Windows.
 */
export function normalizeRepoPath(repoPath: string): string {
  const resolved = path.resolve(repoPath);
  return process.platform === "win32" ? resolved.replace(/\//g, "\\").toLowerCase() : resolved;
}

/** Stable GitNexus registry alias for a repo path (letters/digits/dash/underscore only), used as `-r <name>` in every later call regardless of cwd. */
export function sanitizeRepoAlias(repoPath: string): string {
  const base = path.basename(repoPath).trim();
  const cleaned = base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "repo";
}

function toStats(entry: { files?: number; symbols?: number; edges?: number; clusters?: number; processes?: number }): TNexusRepoStats | undefined {
  if (entry.files === undefined && entry.symbols === undefined) return undefined;
  return {
    files: entry.files ?? 0,
    symbols: entry.symbols ?? 0,
    edges: entry.edges ?? 0,
    clusters: entry.clusters ?? 0,
    processes: entry.processes ?? 0,
  };
}

/**
 * `gitnexus analyze` — always `--index-only` unless `fullContext` is set.
 * Plain analyze (no flags) also writes a GitNexus section into the target
 * repo's AGENTS.md/CLAUDE.md and installs skill files under
 * `.claude/skills/gitnexus/` (confirmed by spike) — surprising side effects
 * for an action the product frames as "just analyze this repo". `fullContext`
 * is a separate, explicitly-opted-into step (see nexus-mcp-configurator.ts's
 * sibling "let GitNexus add its own AI-context files" action).
 */
export async function analyzeRepo(repoPath: string, options?: { name?: string; force?: boolean; fullContext?: boolean }): Promise<TGitNexusCliResult> {
  const args = ["analyze", repoPath];
  if (!options?.fullContext) args.push("--index-only");
  if (options?.name) args.push("--name", options.name, "--allow-duplicate-name");
  if (options?.force) args.push("--force");

  const result = await runGitNexus(args);
  if (!result.ok) return result;

  // Best-effort insurance: a forced re-analyze has been observed (real, reproduced during
  // implementation, twice) to leave the search FTS indexes missing even though the analyze itself
  // reports success — silently degrading Search afterward with no visible error. A repair pass is
  // cheap (seconds) relative to the analyze that just ran; failure here doesn't fail the analyze.
  if (options?.force) {
    await runGitNexus(["analyze", repoPath, "--repair-fts"]).catch(() => undefined);
    await restartGitNexusServeIfWeOwnIt().catch(() => undefined);
  }

  return result;
}

/** Delete a repo's GitNexus index by registry alias or path — does not touch source code, only `.gitnexus/`. */
export async function removeAnalyzedRepo(nameOrPath: string): Promise<TGitNexusCliResult> {
  return runGitNexus(["remove", nameOrPath, "--force"]);
}

/** Compares against a short (`--short HEAD`) or full commit hash — whichever length `indexedCommit` is (the CLI's `list` reports short; `serve`'s `/api/repos` reports full), so callers don't need to know which source it came from. */
async function isRepoCurrentOnDisk(repoPath: string, indexedCommit: string | undefined): Promise<boolean | undefined> {
  if (!indexedCommit) return undefined;
  const short = indexedCommit.trim().length <= 12;
  const result = await runGitSilent(short ? ["rev-parse", "--short", "HEAD"] : ["rev-parse", "HEAD"], repoPath);
  if (result.exitCode !== 0) return undefined;
  return result.stdout.trim() === indexedCommit.trim();
}

export type TListAnalyzedReposResult = { ok: true; repos: TNexusRepoSummary[] } | { ok: false; message: string };

function toStatsFromServe(stats: TGitNexusServeRepoEntry["stats"]): TNexusRepoStats {
  return { files: stats.files, symbols: stats.nodes, edges: stats.edges, clusters: stats.communities, processes: stats.processes };
}

async function buildRepoSummary(name: string, path_: string, indexedAt: string, indexedCommit: string | undefined, stats: TNexusRepoStats | undefined): Promise<TNexusRepoSummary> {
  const [branch, upToDate] = await Promise.all([getCurrentBranch(path_).catch(() => undefined), isRepoCurrentOnDisk(path_, indexedCommit)]);
  const { status, message } = mapRepoStatus({ registered: true, statusInfo: { upToDate, raw: "" } });
  return { name, path: path_, status, message, branch, indexedAt, indexedCommit, stats };
}

/**
 * Registry-wide repo list. Prefers GitNexus's persistent-server `GET
 * /api/repos` (confirmed well under a second) over the equivalent one-off
 * `gitnexus list` CLI spawn (confirmed several seconds — GitNexus's own
 * native-binding startup cost applies to every CLI invocation, not just the
 * heavier query/context/impact commands). Every Nexus route resolves its
 * target repo through this function, making it the single highest-leverage
 * place to avoid a CLI spawn. Falls back to the CLI path if the server can't
 * be reached at all (e.g. GitNexus not installed yet) — `findAnalyzedRepo`'s
 * callers already handle a `setup-required`/`error` status gracefully either way.
 */
export async function listAnalyzedRepos(): Promise<TListAnalyzedReposResult> {
  const fast = await serveListRepos();
  if (fast.ok) {
    const repos = await Promise.all(fast.data.map((entry) => buildRepoSummary(entry.name, entry.path, entry.indexedAt, entry.lastCommit, toStatsFromServe(entry.stats))));
    return { ok: true, repos };
  }

  const result = await runGitNexus(["list"]);
  if (!result.ok) {
    return { ok: false, message: result.message };
  }

  const entries = parseGitNexusList(result.stdout);
  const repos = await Promise.all(entries.map((entry) => buildRepoSummary(entry.name, entry.path, entry.indexedAt ?? "", entry.commit, toStats(entry))));
  return { ok: true, repos };
}

export type TRepoFreshnessResult = { ok: true; info: TGitNexusStatusInfo } | { ok: false; message: string };

/** GitNexus's own view of one repo's freshness (`gitnexus status`, run with cwd = repoPath). Used for the repo detail screen; the list screen above computes freshness itself to avoid N extra subprocess calls. */
export async function getRepoFreshness(repoPath: string): Promise<TRepoFreshnessResult> {
  const result = await runGitNexus(["status"], { cwd: repoPath });
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, info: parseGitNexusStatus(result.stdout) };
}
