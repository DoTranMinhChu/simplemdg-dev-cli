import type http from "node:http";
import path from "node:path";
import { analyzeSession } from "../../ai/ai-session-analysis";
import { buildContinuationPrompt, deriveTurns } from "../../ai/ai-session-analysis";
import { openFileInVsCode, openProjectInVsCode } from "../../ai/ai-session-command-service";
import type { AiSessionStore } from "../../ai/ai-session-store";
import { getString, readJsonBody, sendJson, type TJsonBody } from "../../studio-shared/studio-server-kit";
import { pickFolderNative } from "../../studio-shared/native-folder-picker";
import { getUncommittedDiffFiles, getStagedDiffFiles, getCommitDiffFiles, getBranchDiffFiles } from "../../git/git-diff-service";
import type { TGitChangeScope } from "../../git/git-diff-service";
import { analyzeChangeImpact, analyzeSymbolChangeImpact } from "../nexus-change-impact-service";
import { getGitNexusVersion } from "../gitnexus-runtime";
import { ensureGitNexusServeRunning } from "../gitnexus-serve-launcher";
import { configureCodingAgent, removeCodingAgentConfig, type TNexusCodingAgent } from "../nexus-mcp-configurator";
import { getProjectOverview } from "../nexus-overview-service";
import { getSymbolContext, getSymbolImpact, searchFeature } from "../nexus-query-service";
import { discoverGitRepositories } from "../nexus-repo-discovery";
import { analyzeRepo, getRepoFreshness, listAnalyzedRepos, normalizeRepoPath, removeAnalyzedRepo, sanitizeRepoAlias } from "../nexus-repo-service";
import { compareSessionToCodeIntelligence } from "../nexus-session-comparison-service";
import { mapInstallStatus } from "../nexus-status";
import {
  addRepoToWorkspace,
  createWorkspace,
  getWorkspaceContracts,
  getWorkspaceImpact,
  getWorkspaceStatus,
  listWorkspaces,
  removeRepoFromWorkspace,
  searchWorkspace,
  syncWorkspace,
} from "../nexus-workspace-service";
import type { TNexusRepoSummary } from "../nexus-types";

const PREFIX = "/api/nexus";

async function findAnalyzedRepo(repoPath: string): Promise<TNexusRepoSummary | undefined> {
  const listed = await listAnalyzedRepos();
  if (!listed.ok) return undefined;
  const normalized = normalizeRepoPath(repoPath);
  return listed.repos.find((repo) => normalizeRepoPath(repo.path) === normalized || repo.name === repoPath);
}

function parseChangeScopeBody(body: TJsonBody): TGitChangeScope {
  if (typeof body.commit === "string" && body.commit) return { kind: "commit", hash: body.commit };
  if (typeof body.sourceBranch === "string" && typeof body.targetBranch === "string" && body.sourceBranch && body.targetBranch) {
    return { kind: "branch-diff", source: body.sourceBranch, target: body.targetBranch };
  }
  if (body.staged === true) return { kind: "staged" };
  return { kind: "uncommitted" };
}

async function resolveChangeScopeFilesForBody(repoPath: string, scope: TGitChangeScope) {
  switch (scope.kind) {
    case "uncommitted":
      return getUncommittedDiffFiles(repoPath);
    case "staged":
      return getStagedDiffFiles(repoPath);
    case "commit":
      return getCommitDiffFiles(repoPath, scope.hash);
    case "branch-diff":
      return getBranchDiffFiles(repoPath, scope.source, scope.target);
  }
}

/**
 * Handles every `/api/nexus/*` route. Mounted alongside `handleAiStudioApi`/
 * `handlePluginsApi` in ai-studio-server.ts (not a 4th dedicated server) —
 * Phase 3 (session comparison) needs both `store` (session data) and GitNexus
 * data in one request handler. Every handler returns a 200 with a typed
 * `{status, message}` degradation payload for EXPECTED failures (not
 * installed, repo not analyzed, etc.) — only a genuinely unexpected exception
 * produces a 500, so a GitNexus problem can never take down the rest of AI
 * Studio's API.
 */
export async function handleNexusApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, store: AiSessionStore | undefined): Promise<boolean> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (!pathname.startsWith(PREFIX)) return false;

  const segments = pathname.slice(PREFIX.length).split("/").filter(Boolean);
  const params = url.searchParams;

  try {
    if (segments.length === 1 && segments[0] === "readiness" && method === "GET") {
      const version = await getGitNexusVersion();
      const readiness = mapInstallStatus(version);
      sendJson(res, { ...readiness, installed: version.installed, version: version.installed ? version.version : undefined });
      return true;
    }

    if (segments.length === 1 && segments[0] === "repos" && method === "GET") {
      const result = await listAnalyzedRepos();
      if (!result.ok) {
        sendJson(res, { status: "setup-required", message: result.message, repos: [] });
        return true;
      }
      sendJson(res, { repos: result.repos });
      return true;
    }

    if (segments.length === 1 && segments[0] === "open-file" && method === "POST") {
      const body = await readJsonBody(req);
      const result = await openFileInVsCode(getString(body, "repoPath"), getString(body, "filePath"), typeof body.line === "number" ? body.line : undefined);
      sendJson(res, result);
      return true;
    }

    if (segments.length === 1 && segments[0] === "open-vscode" && method === "POST") {
      const body = await readJsonBody(req);
      const result = await openProjectInVsCode(getString(body, "repoPath"));
      sendJson(res, result);
      return true;
    }

    if (segments.length === 1 && segments[0] === "pick-folder" && method === "POST") {
      const body = await readJsonBody(req);
      const initialPath = getString(body, "initialPath") || undefined;
      const result = await pickFolderNative(initialPath);
      sendJson(res, result);
      return true;
    }

    if (segments.length === 1 && segments[0] === "discover" && method === "POST") {
      const body = await readJsonBody(req);
      const folder = getString(body, "folder") || process.cwd();
      const discovered = await discoverGitRepositories(path.resolve(folder));
      sendJson(res, { repos: discovered });
      return true;
    }

    if (segments.length === 1 && segments[0] === "analyze" && method === "POST") {
      const body = await readJsonBody(req);
      const repoPath = getString(body, "repoPath");
      if (!repoPath) {
        sendJson(res, { error: "repoPath is required" }, 400);
        return true;
      }
      const name = getString(body, "name") || sanitizeRepoAlias(repoPath);
      const result = await analyzeRepo(repoPath, { name, force: body.force === true, fullContext: body.fullContext === true });
      if (!result.ok) {
        sendJson(res, { status: result.status, message: result.message });
        return true;
      }
      sendJson(res, { status: "ready", message: "Repository analyzed.", output: result.stdout.trim() });
      return true;
    }

    if (segments.length === 2 && segments[1] === "remove" && method === "POST") {
      const result = await removeAnalyzedRepo(decodeURIComponent(segments[0]));
      if (!result.ok) {
        sendJson(res, { status: result.status, message: result.message });
        return true;
      }
      sendJson(res, { status: "ready", message: "Removed. Source files are untouched." });
      return true;
    }

    if (segments.length === 1 && segments[0] === "overview" && method === "GET") {
      const repoPath = params.get("repo") ?? "";
      const repo = await findAnalyzedRepo(repoPath);
      if (!repo) {
        sendJson(res, { status: "index-required", message: "This repository hasn't been analyzed yet." });
        return true;
      }
      sendJson(res, { repo, overview: getProjectOverview(repo) });
      return true;
    }

    if (segments.length === 1 && segments[0] === "search" && method === "GET") {
      const repoPath = params.get("repo") ?? "";
      const query = params.get("q") ?? "";
      const repo = await findAnalyzedRepo(repoPath);
      if (!repo) {
        sendJson(res, { status: "index-required", message: "This repository hasn't been analyzed yet." });
        return true;
      }
      if (!query.trim()) {
        sendJson(res, { query: "", matches: [] });
        return true;
      }
      const outcome = await searchFeature(query, { repo: repo.name });
      if (!outcome.ok) {
        sendJson(res, { status: "error", message: outcome.message });
        return true;
      }
      sendJson(res, outcome.result);
      return true;
    }

    if (segments.length === 1 && segments[0] === "trace" && method === "GET") {
      const repoPath = params.get("repo") ?? "";
      const symbol = params.get("symbol") ?? "";
      const repo = await findAnalyzedRepo(repoPath);
      if (!repo) {
        sendJson(res, { status: "index-required", message: "This repository hasn't been analyzed yet." });
        return true;
      }
      const outcome = await getSymbolContext(symbol, { repo: repo.name, cwd: repo.path, file: params.get("file") ?? undefined });
      if (!outcome.ok) {
        sendJson(res, { status: "error", message: outcome.message });
        return true;
      }
      sendJson(res, outcome.result);
      return true;
    }

    if (segments.length === 1 && segments[0] === "impact" && method === "POST") {
      const body = await readJsonBody(req);
      const repoPath = getString(body, "repo");
      const target = getString(body, "target");
      const repo = await findAnalyzedRepo(repoPath);
      if (!repo) {
        sendJson(res, { status: "index-required", message: "This repository hasn't been analyzed yet." });
        return true;
      }
      const outcome = await getSymbolImpact(target, { repo: repo.name, cwd: repo.path });
      if (!outcome.ok) {
        sendJson(res, { status: "error", message: outcome.message });
        return true;
      }
      sendJson(res, outcome.result);
      return true;
    }

    if (segments.length === 1 && segments[0] === "changes" && method === "POST") {
      const body = await readJsonBody(req);
      const repoPath = getString(body, "repo");
      const repo = await findAnalyzedRepo(repoPath);
      if (!repo) {
        sendJson(res, { status: "index-required", message: "This repository hasn't been analyzed yet." });
        return true;
      }
      const scope = parseChangeScopeBody(body);
      const outcome = await analyzeChangeImpact(repo.path, repo.name, scope);
      if (!outcome.ok) {
        sendJson(res, { status: "error", message: outcome.message });
        return true;
      }
      const changedFiles = await resolveChangeScopeFilesForBody(repo.path, scope).catch(() => []);
      sendJson(res, { ...outcome.result, changedFiles });
      return true;
    }

    if (segments.length === 1 && segments[0] === "symbol-impact" && method === "POST") {
      const body = await readJsonBody(req);
      const repoPath = getString(body, "repo");
      const symbol = getString(body, "symbol");
      const repo = await findAnalyzedRepo(repoPath);
      if (!repo) {
        sendJson(res, { status: "index-required", message: "This repository hasn't been analyzed yet." });
        return true;
      }
      const outcome = await analyzeSymbolChangeImpact(repo.name, symbol, repo.path);
      if (!outcome.ok) {
        sendJson(res, { status: "error", message: outcome.message });
        return true;
      }
      sendJson(res, outcome.result);
      return true;
    }

    if (segments.length === 1 && segments[0] === "workspaces" && method === "GET") {
      const result = await listWorkspaces();
      if (!result.ok) {
        sendJson(res, { status: "error", message: result.message, names: [] });
        return true;
      }
      sendJson(res, { names: result.names });
      return true;
    }

    if (segments.length === 1 && segments[0] === "workspaces" && method === "POST") {
      const body = await readJsonBody(req);
      const name = getString(body, "name");
      if (!name) {
        sendJson(res, { error: "name is required" }, 400);
        return true;
      }
      const result = await createWorkspace(name);
      sendJson(res, result.ok ? { status: "ready", message: "Workspace created." } : { status: "error", message: result.message });
      return true;
    }

    if (segments.length === 3 && segments[0] === "workspaces" && segments[2] === "members" && method === "POST") {
      const body = await readJsonBody(req);
      const groupPath = getString(body, "groupPath");
      const registryName = getString(body, "registryName");
      const result = await addRepoToWorkspace(decodeURIComponent(segments[1]), groupPath, registryName);
      sendJson(res, result.ok ? { status: "ready", message: "Added to workspace." } : { status: "error", message: result.message });
      return true;
    }

    if (segments.length === 4 && segments[0] === "workspaces" && segments[2] === "members" && segments[3] === "remove" && method === "POST") {
      const body = await readJsonBody(req);
      const groupPath = getString(body, "groupPath");
      const result = await removeRepoFromWorkspace(decodeURIComponent(segments[1]), groupPath);
      sendJson(res, result.ok ? { status: "ready", message: "Removed from workspace." } : { status: "error", message: result.message });
      return true;
    }

    if (segments.length === 3 && segments[0] === "workspaces" && segments[2] === "sync" && method === "POST") {
      const result = await syncWorkspace(decodeURIComponent(segments[1]));
      sendJson(res, result.ok ? { status: "ready", message: "Synced." } : { status: "error", message: result.message });
      return true;
    }

    if (segments.length === 3 && segments[0] === "workspaces" && segments[2] === "impact" && method === "POST") {
      const body = await readJsonBody(req);
      const groupPath = getString(body, "groupPath");
      const target = getString(body, "target");
      const result = await getWorkspaceImpact(decodeURIComponent(segments[1]), groupPath, target);
      if (!result.ok) {
        sendJson(res, { status: "error", message: result.message });
        return true;
      }
      sendJson(res, result.result);
      return true;
    }

    if (segments.length === 3 && segments[0] === "workspaces" && segments[2] === "search" && method === "GET") {
      const query = params.get("q") ?? "";
      const result = await searchWorkspace(decodeURIComponent(segments[1]), query);
      if (!result.ok) {
        sendJson(res, { status: "error", message: result.message });
        return true;
      }
      sendJson(res, result.result);
      return true;
    }

    if (segments.length === 3 && segments[0] === "workspaces" && segments[2] === "contracts" && method === "GET") {
      const result = await getWorkspaceContracts(decodeURIComponent(segments[1]));
      if (!result.ok) {
        sendJson(res, { status: "error", message: result.message, contracts: [] });
        return true;
      }
      sendJson(res, { contracts: result.contracts });
      return true;
    }

    if (segments.length === 2 && segments[0] === "workspaces" && method === "GET") {
      const result = await getWorkspaceStatus(decodeURIComponent(segments[1]));
      if (!result.ok) {
        sendJson(res, { status: "error", message: result.message });
        return true;
      }
      sendJson(res, result.status);
      return true;
    }

    if (segments.length === 2 && segments[0] === "advanced" && segments[1] === "graph-view" && method === "POST") {
      const result = await ensureGitNexusServeRunning();
      sendJson(res, result.ok ? { status: "ready", url: result.url } : { status: "error", message: result.message });
      return true;
    }

    if (segments.length === 1 && segments[0] === "configure" && method === "POST") {
      const body = await readJsonBody(req);
      const agent = getString(body, "agent") as TNexusCodingAgent;
      const repoPath = getString(body, "repoPath") || undefined;
      if (!agent) {
        sendJson(res, { error: "agent is required" }, 400);
        return true;
      }
      const result = body.remove === true ? await removeCodingAgentConfig(agent, repoPath) : await configureCodingAgent(agent, repoPath);
      sendJson(res, result.ok ? { status: "ready", message: `${agent} configured.` } : { status: result.status, message: result.message });
      return true;
    }

    if (segments.length === 1 && segments[0] === "session-comparison" && method === "GET") {
      if (!store) {
        sendJson(res, { status: "error", message: "AI Studio's session store is unavailable (requires Node 22.5+)." });
        return true;
      }
      const sessionId = params.get("sessionId") ?? "";
      const session = store.getSession(sessionId);
      if (!session) {
        sendJson(res, { error: "Session not found" }, 404);
        return true;
      }
      const observations = store.getObservations(sessionId);
      const analysis = analyzeSession(sessionId, observations);
      const outcome = await compareSessionToCodeIntelligence(session.cwd, analysis);
      if (!outcome.ok) {
        sendJson(res, { status: "index-required", message: outcome.message });
        return true;
      }
      sendJson(res, outcome.comparison);
      return true;
    }

    if (segments.length === 1 && segments[0] === "continuation-prompt" && method === "GET") {
      if (!store) {
        sendJson(res, { error: "AI Studio's session store is unavailable (requires Node 22.5+)." }, 503);
        return true;
      }
      const sessionId = params.get("sessionId") ?? "";
      const session = store.getSession(sessionId);
      if (!session) {
        sendJson(res, { error: "Session not found" }, 404);
        return true;
      }
      const observations = store.getObservations(sessionId);
      const turns = deriveTurns(observations);
      const analysis = analyzeSession(sessionId, observations);
      const basePrompt = buildContinuationPrompt(session, turns, analysis);

      const comparison = await compareSessionToCodeIntelligence(session.cwd, analysis);
      if (!comparison.ok) {
        sendJson(res, { prompt: basePrompt, codeIntelligenceAvailable: false });
        return true;
      }

      const { missedFiles, affectedProcessCount, risk } = comparison.comparison;
      const nexusSection = [
        "",
        "--- Code Intelligence (GitNexus) ---",
        `Risk: ${risk.toUpperCase()} (${affectedProcessCount} affected execution flow${affectedProcessCount === 1 ? "" : "s"})`,
        missedFiles.length > 0
          ? `Files GitNexus flagged as related that were NOT inspected this session: ${missedFiles.join(", ")}`
          : "No related files were found unvisited by this session.",
        "Generated from GitNexus's own analysis, not the AI agent's claims.",
      ].join("\n");

      sendJson(res, { prompt: `${basePrompt}\n${nexusSection}`, codeIntelligenceAvailable: true });
      return true;
    }

    sendJson(res, { error: "Not found" }, 404);
    return true;
  } catch (error) {
    sendJson(res, { status: "error", message: error instanceof Error ? error.message : String(error) }, 500);
    return true;
  }
}
