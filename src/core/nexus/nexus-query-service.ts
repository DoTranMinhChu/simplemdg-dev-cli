import { runGitNexusJson } from "./gitnexus-cli-client";
import { serveSearch } from "./gitnexus-serve-client";
import type { TNexusContextResult, TNexusRiskLevel, TNexusSearchResult, TNexusSymbolRef } from "./nexus-types";

type TRawSymbolRef = { uid?: string; id?: string; name: string; kind?: string; type?: string; filePath?: string; startLine?: number; endLine?: number };

function toSymbolRef(raw: TRawSymbolRef): TNexusSymbolRef {
  return {
    uid: raw.uid ?? raw.id ?? raw.name,
    name: raw.name,
    kind: raw.kind ?? raw.type,
    filePath: raw.filePath ?? "",
    startLine: raw.startLine,
    endLine: raw.endLine,
  };
}

// --- search --------------------------------------------------------------------

export type TNexusQueryOutcome = { ok: true; result: TNexusSearchResult } | { ok: false; message: string };

/**
 * "Search a feature" — wraps GitNexus's persistent-server `POST /api/search`
 * (file-ranked keyword+semantic match), NOT the one-off `gitnexus query` CLI
 * command. Measured during implementation: the CLI spawn costs 10-15+
 * seconds every call (GitNexus's own native-binding startup, unaffected by
 * npx/version pinning), while the already-running server answers in well
 * under a second — the difference between "feels broken" and "feels instant"
 * for the single most-used Code Intelligence action.
 */
export async function searchFeature(query: string, options: { repo: string }): Promise<TNexusQueryOutcome> {
  const outcome = await serveSearch(options.repo, query);
  if (!outcome.ok) return { ok: false, message: outcome.message };

  const matches = (outcome.data.results ?? []).map((match) => ({ filePath: match.filePath, score: match.score, rank: match.rank, symbolIds: match.nodeIds ?? [] }));
  return { ok: true, result: { query, matches, warning: outcome.data.warning } };
}

// --- context (360-degree symbol view) ------------------------------------------

type TRawContextResponse = {
  status: string;
  symbol?: TRawSymbolRef;
  incoming?: { calls?: TRawSymbolRef[] };
  outgoing?: { calls?: TRawSymbolRef[] };
};

export type TNexusContextOutcome = { ok: true; result: TNexusContextResult } | { ok: false; message: string };

/** "Trace an execution flow" starting point / dependency view — wraps `gitnexus context`. */
export async function getSymbolContext(name: string, options: { repo: string; cwd?: string; file?: string }): Promise<TNexusContextOutcome> {
  const args = ["context", name, "-r", options.repo];
  if (options.file) args.push("-f", options.file);

  const result = await runGitNexusJson<TRawContextResponse>(args, { cwd: options.cwd });
  if (!result.ok) return { ok: false, message: result.message };

  if (result.data.status !== "found" || !result.data.symbol) {
    return { ok: true, result: { found: false, callers: [], callees: [] } };
  }

  return {
    ok: true,
    result: {
      found: true,
      symbol: toSymbolRef(result.data.symbol),
      callers: (result.data.incoming?.calls ?? []).map(toSymbolRef),
      callees: (result.data.outgoing?.calls ?? []).map(toSymbolRef),
    },
  };
}

// --- impact (blast radius) ------------------------------------------------------

type TRawImpactResponse = {
  error?: string;
  target?: { id?: string; name: string; type?: string; filePath?: string };
  risk: string;
  impactedCount: number;
  summary?: { direct: number; processes_affected: number; modules_affected: number };
  affected_processes?: Array<{ name: string; filePath: string }>;
};

export type TNexusImpactResult = {
  found: boolean;
  target?: TNexusSymbolRef;
  risk: TNexusRiskLevel;
  /** Always paired with risk — never render a risk level without this sentence (product requirement: "always explain why"). */
  riskReason: string;
  impactedCount: number;
  affectedProcesses: Array<{ name: string; filePath: string }>;
};

export function normalizeRisk(raw: string | undefined): TNexusRiskLevel {
  const value = (raw ?? "").toLowerCase();
  return value === "low" || value === "medium" || value === "high" ? value : "unknown";
}

/** Ad-hoc blast-radius query for a specific symbol — wraps `gitnexus impact`. Bare file paths are NOT resolvable as targets (confirmed by spike); callers must pass a real symbol name. */
export async function getSymbolImpact(
  target: string,
  options: { repo: string; cwd?: string; direction?: "upstream" | "downstream"; summaryOnly?: boolean },
): Promise<{ ok: true; result: TNexusImpactResult } | { ok: false; message: string }> {
  const args = ["impact", target, "-r", options.repo];
  if (options.direction) args.push("-d", options.direction);
  if (options.summaryOnly) args.push("--summary-only");

  const result = await runGitNexusJson<TRawImpactResponse>(args, { cwd: options.cwd });
  if (!result.ok) return { ok: false, message: result.message };

  const data = result.data;

  if (data.error || !data.target) {
    return {
      ok: true,
      result: {
        found: false,
        risk: "unknown",
        riskReason: data.error ? `GitNexus reported: ${data.error}` : "This symbol wasn't found in the analyzed code.",
        impactedCount: 0,
        affectedProcesses: [],
      },
    };
  }

  const affectedProcesses = (data.affected_processes ?? []).map((process) => ({ name: process.name, filePath: process.filePath }));
  const direct = data.summary?.direct ?? affectedProcesses.length;
  const processesAffected = data.summary?.processes_affected ?? 0;

  const riskReason =
    data.impactedCount > 0
      ? `Used by ${direct} direct caller${direct === 1 ? "" : "s"}${
          processesAffected > 0 ? ` and participates in ${processesAffected} business flow${processesAffected === 1 ? "" : "s"}` : ""
        }.`
      : "No known callers found in the analyzed code.";

  return {
    ok: true,
    result: {
      found: true,
      target: toSymbolRef({ uid: data.target.id, name: data.target.name, kind: data.target.type, filePath: data.target.filePath ?? "" }),
      risk: normalizeRisk(data.risk),
      riskReason,
      impactedCount: data.impactedCount,
      affectedProcesses,
    },
  };
}

// --- cypher (advanced/raw) -------------------------------------------------------

type TRawCypherResponse = { markdown: string; row_count: number };

/** Raw Cypher escape hatch for the UI's "Advanced" section only — never used by any default/plain-English view. */
export async function runCypherQuery(query: string, options: { repo: string; cwd?: string; limit?: number }): Promise<{ ok: true; markdown: string; rowCount: number } | { ok: false; message: string }> {
  const args = ["cypher", query, "-r", options.repo];
  if (options.limit) args.push("-l", String(options.limit));

  const result = await runGitNexusJson<TRawCypherResponse>(args, { cwd: options.cwd });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, markdown: result.data.markdown, rowCount: result.data.row_count };
}
