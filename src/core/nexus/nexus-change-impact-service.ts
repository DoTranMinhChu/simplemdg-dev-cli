import type { TGitChangeScope } from "../git/git-diff-service";
import { runGitNexus } from "./gitnexus-cli-client";
import { parseDetectChanges, type TGitNexusDetectChanges } from "./nexus-output-parser";
import { getSymbolImpact } from "./nexus-query-service";
import type { TNexusChangeImpactResult } from "./nexus-types";

export type TNexusChangeImpactOutcome = { ok: true; result: TNexusChangeImpactResult } | { ok: false; message: string };

function describeScope(scope: TGitChangeScope): string {
  switch (scope.kind) {
    case "uncommitted":
      return "Uncommitted changes";
    case "staged":
      return "Staged changes";
    case "commit":
      return `Commit ${scope.hash.slice(0, 12)}`;
    case "branch-diff":
      return `${scope.source} vs ${scope.target}`;
  }
}

function toImpactResult(scopeDescription: string, parsed: TGitNexusDetectChanges, caveat?: string): TNexusChangeImpactResult {
  const riskReason = !parsed.changed
    ? "No changes in this scope."
    : parsed.affectedProcessCount > 0
      ? `${parsed.symbolCount} changed symbol${parsed.symbolCount === 1 ? "" : "s"} across ${parsed.fileCount} file${parsed.fileCount === 1 ? "" : "s"}, affecting ${parsed.affectedProcessCount} business flow${parsed.affectedProcessCount === 1 ? "" : "s"}.`
      : `${parsed.symbolCount} changed symbol${parsed.symbolCount === 1 ? "" : "s"} across ${parsed.fileCount} file${parsed.fileCount === 1 ? "" : "s"}; no indexed business flows affected.`;

  return {
    scopeDescription,
    changed: parsed.changed,
    fileCount: parsed.fileCount,
    symbolCount: parsed.symbolCount,
    affectedProcessCount: parsed.affectedProcessCount,
    risk: parsed.risk,
    riskReason,
    changedSymbols: parsed.changedSymbols.map((symbol) => ({ name: symbol.name, detail: symbol.filePath })),
    caveat,
  };
}

/**
 * Change Impact Analysis over a git diff scope. Delegates entirely to
 * `gitnexus detect-changes`, which already combines the diff, the affected
 * symbols, and a risk level in one call — no custom cross-referencing needed
 * for the scopes it supports natively (unstaged/staged/compare-against-a-ref).
 * "commit" is approximated via `compare` against the commit's parent, with an
 * explicit caveat when the checkout has moved past that commit (detect-changes
 * has no "diff between two arbitrary non-HEAD points" mode).
 */
export async function analyzeChangeImpact(repoPath: string, repoAlias: string, scope: TGitChangeScope): Promise<TNexusChangeImpactOutcome> {
  const scopeDescription = describeScope(scope);

  if (scope.kind === "uncommitted" || scope.kind === "staged") {
    const result = await runGitNexus(["detect-changes", "-s", scope.kind === "uncommitted" ? "unstaged" : "staged", "-r", repoAlias], { cwd: repoPath });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, result: toImpactResult(scopeDescription, parseDetectChanges(result.stdout)) };
  }

  if (scope.kind === "branch-diff") {
    const result = await runGitNexus(["detect-changes", "-s", "compare", "-b", scope.target, "-r", repoAlias], { cwd: repoPath });
    if (!result.ok) return { ok: false, message: result.message };
    return {
      ok: true,
      result: toImpactResult(
        scopeDescription,
        parseDetectChanges(result.stdout),
        "Compares the currently checked-out branch against the target branch — check out the source branch first if it isn't already active.",
      ),
    };
  }

  // "commit": no direct two-arbitrary-points mode exists, so this approximates
  // via compare-against-parent. Accurate only when nothing has landed since.
  const result = await runGitNexus(["detect-changes", "-s", "compare", "-b", `${scope.hash}^`, "-r", repoAlias], { cwd: repoPath });
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    result: toImpactResult(
      scopeDescription,
      parseDetectChanges(result.stdout),
      "Shows everything changed between this commit's parent and the current checkout. If newer commits exist since, this reflects more than just this one commit.",
    ),
  };
}

/** Change Impact Analysis for one explicitly-picked function/class (not a git diff) — e.g. from a Search result's "Analyze impact" action. */
export async function analyzeSymbolChangeImpact(repoAlias: string, symbolName: string, cwd?: string): Promise<TNexusChangeImpactOutcome> {
  const impact = await getSymbolImpact(symbolName, { repo: repoAlias, cwd });
  if (!impact.ok) return { ok: false, message: impact.message };

  const data = impact.result;
  return {
    ok: true,
    result: {
      scopeDescription: `Symbol: ${symbolName}`,
      changed: true,
      fileCount: data.target ? 1 : 0,
      symbolCount: data.found ? 1 : 0,
      affectedProcessCount: data.affectedProcesses.length,
      risk: data.risk,
      riskReason: data.riskReason,
      changedSymbols: data.target ? [{ name: data.target.name, detail: data.target.filePath }] : [],
    },
  };
}
