import path from "node:path";
import type { TSessionAnalysis } from "../ai/ai-types";
import { runGitNexus } from "./gitnexus-cli-client";
import { parseDetectChanges } from "./nexus-output-parser";
import { listAnalyzedRepos, normalizeRepoPath } from "./nexus-repo-service";
import type { TNexusRepoSummary, TNexusRiskLevel } from "./nexus-types";

export type TNexusSessionComparison = {
  repo: TNexusRepoSummary;
  agentTouchedFiles: string[];
  gitNexusAffectedFiles: string[];
  /** Files GitNexus flagged as part of this change that the agent's session never read or edited — the concrete "missed dependency" finding the product spec asks for. */
  missedFiles: string[];
  affectedProcessCount: number;
  risk: TNexusRiskLevel;
  summary: string;
};

function toRepoRelativePath(repoPath: string, absoluteOrRelative: string): string {
  const absolute = path.isAbsolute(absoluteOrRelative) ? absoluteOrRelative : path.join(repoPath, absoluteOrRelative);
  return path.relative(repoPath, absolute).split(path.sep).join("/");
}

/**
 * Cross-references what an AI coding session touched (`TSessionAnalysis.fileImpact`, already
 * computed by the existing AI Studio pipeline) against what GitNexus reports as changed in that
 * same repo right now. There is no way to scope `detect-changes` to one specific past session, so
 * this uses the `all` (staged + unstaged) scope as a stand-in for "this session's edits" — accurate
 * for a session whose changes haven't been committed away yet, which is the common "review before
 * commit" case this feature targets; the comparison honestly returns nothing once that's no longer true.
 */
export async function compareSessionToCodeIntelligence(
  sessionCwd: string,
  analysis: TSessionAnalysis,
): Promise<{ ok: true; comparison: TNexusSessionComparison } | { ok: false; message: string }> {
  const listed = await listAnalyzedRepos();
  if (!listed.ok) return { ok: false, message: listed.message };

  const normalizedCwd = normalizeRepoPath(sessionCwd);
  const repo = listed.repos.find((candidate) => {
    const normalizedCandidate = normalizeRepoPath(candidate.path);
    return normalizedCwd === normalizedCandidate || normalizedCwd.startsWith(normalizedCandidate + path.sep);
  });
  if (!repo) {
    return { ok: false, message: "This session's project hasn't been analyzed by Code Intelligence yet." };
  }

  const agentTouchedFiles = analysis.fileImpact.map((impact) => toRepoRelativePath(repo.path, impact.path));

  const result = await runGitNexus(["detect-changes", "-s", "all", "-r", repo.name], { cwd: repo.path });
  if (!result.ok) return { ok: false, message: result.message };

  const parsed = parseDetectChanges(result.stdout);
  const gitNexusAffectedFiles = [...new Set(parsed.changedSymbols.map((symbol) => symbol.filePath).filter((file): file is string => Boolean(file)))];

  const touchedSet = new Set(agentTouchedFiles);
  const missedFiles = gitNexusAffectedFiles.filter((file) => !touchedSet.has(file));

  const summary = !parsed.changed
    ? "No uncommitted or staged changes remain in this repository to compare against the session."
    : missedFiles.length > 0
      ? `The agent touched ${agentTouchedFiles.length} file${agentTouchedFiles.length === 1 ? "" : "s"}, but GitNexus found ${missedFiles.length} related file${missedFiles.length === 1 ? "" : "s"} still changed that it did not inspect: ${missedFiles.slice(0, 5).join(", ")}${missedFiles.length > 5 ? ", ..." : ""}.`
      : `The agent touched every file GitNexus flagged as changed in this scope.`;

  return {
    ok: true,
    comparison: {
      repo,
      agentTouchedFiles,
      gitNexusAffectedFiles,
      missedFiles,
      affectedProcessCount: parsed.affectedProcessCount,
      risk: parsed.risk,
      summary,
    },
  };
}
