import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { nexusApi } from "../../../api/nexus-api-client";
import type { TNexusReadiness, TNexusRepoSummary } from "../../../api/nexus-api-types";
import { useAiStudioStore } from "../state/ai-studio-store";
import { NexusRepoList } from "./NexusRepoList";
import { NexusRepoWorkspace } from "./NexusRepoWorkspace";
import { NexusWorkspaceList } from "./NexusWorkspaceList";
import { WorkspaceDetailView } from "./WorkspaceDetailView";

type TMode = "repos" | "workspaces";

/**
 * Code Intelligence — GitNexus-powered project understanding, change impact,
 * and (via the Graph tab on a selected repo) its own visual graph explorer.
 * Mirrors AiSessionsPage's sidebar+workspace split, with a persistent
 * readiness banner instead of a blocking setup gate — the repo list and
 * Add/Discover flow stay usable even before GitNexus is confirmed installed,
 * since the first real analyze/configure action is what actually triggers
 * its (automatic, one-time) install via npx.
 */
export function AiNexusPage(): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [mode, setMode] = useState<TMode>("repos");
  const [readiness, setReadiness] = useState<TNexusReadiness | undefined>();
  const [repos, setRepos] = useState<TNexusRepoSummary[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [workspaceNames, setWorkspaceNames] = useState<string[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | undefined>();

  const reloadReadiness = useCallback(() => {
    nexusApi.getReadiness().then(setReadiness).catch(() => undefined);
  }, []);

  const reloadRepos = useCallback(async () => {
    setReposLoading(true);
    try {
      const response = await nexusApi.listRepos();
      setRepos(response.repos);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setReposLoading(false);
    }
  }, [toast]);

  const reloadWorkspaces = useCallback(async () => {
    try {
      const response = await nexusApi.listWorkspaces();
      setWorkspaceNames(response.names);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  }, [toast]);

  useEffect(() => {
    reloadReadiness();
    void reloadRepos();
    void reloadWorkspaces();
  }, [reloadReadiness, reloadRepos, reloadWorkspaces]);

  const selectedRepo = repos.find((repo) => repo.path === selectedPath);
  const hasSelection = mode === "repos" ? Boolean(selectedRepo) : Boolean(selectedWorkspace);

  return (
    <div className={`main-layout ai-nexus-layout${hasSelection ? " has-selection" : ""}`}>
      <aside className="sidebar">
        <div className="nexus-readiness-strip">
          {readiness && readiness.status !== "ready" ? (
            <div className="nexus-readiness-banner">
              <div>{readiness.message ?? "GitNexus isn't ready yet."}</div>
              <button type="button" className="btn sm ghost" onClick={reloadReadiness}>
                Check again
              </button>
            </div>
          ) : readiness ? (
            <div className="note faint" style={{ padding: "6px 10px" }}>
              GitNexus {readiness.version} · analyzed locally
            </div>
          ) : null}
        </div>

        <div className="nexus-mode-tabs">
          <button type="button" className={`nexus-mode-tab${mode === "repos" ? " active" : ""}`} onClick={() => setMode("repos")}>
            Repositories
          </button>
          <button type="button" className={`nexus-mode-tab${mode === "workspaces" ? " active" : ""}`} onClick={() => setMode("workspaces")}>
            Workspaces
          </button>
        </div>

        {mode === "repos" ? (
          reposLoading ? (
            <EmptyState>
              <span className="spin" /> Loading...
            </EmptyState>
          ) : (
            <NexusRepoList
              repos={repos}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              onChanged={() => {
                void reloadRepos();
                reloadReadiness();
              }}
              toast={toast}
            />
          )
        ) : (
          <NexusWorkspaceList names={workspaceNames} selectedName={selectedWorkspace} onSelect={setSelectedWorkspace} onChanged={() => void reloadWorkspaces()} toast={toast} />
        )}
      </aside>
      <div className="workspace">
        {mode === "repos" && selectedRepo ? (
          <div className="ai-session-detail-shell">
            <div className="ai-mobile-back-bar">
              <button type="button" className="ai-mobile-back" onClick={() => setSelectedPath(undefined)}>
                ← Repositories
              </button>
            </div>
            <div className="ai-session-detail-area">
              <NexusRepoWorkspace repo={selectedRepo} onChanged={() => void reloadRepos()} toast={toast} />
            </div>
          </div>
        ) : mode === "workspaces" && selectedWorkspace ? (
          <div className="ai-session-detail-shell">
            <div className="ai-mobile-back-bar">
              <button type="button" className="ai-mobile-back" onClick={() => setSelectedWorkspace(undefined)}>
                ← Workspaces
              </button>
            </div>
            <div className="ai-session-detail-area">
              <WorkspaceDetailView workspaceName={selectedWorkspace} analyzedRepos={repos} toast={toast} />
            </div>
          </div>
        ) : (
          <div className="welcome">
            <h1>Code Intelligence</h1>
            <div className="lede">Understand this project, trace execution flows, and see change impact before you commit.</div>

            {mode === "repos" && repos.length === 0 && (
              <div className="wcards">
                <div className="wcard" style={{ cursor: "default" }}>
                  <h3>What is this?</h3>
                  <p>
                    It reads your code once and remembers how everything connects — who calls what, which files depend on which. Instead of "8 incoming edges" you get a plain sentence: <em>"Used
                    by 6 functions and part of 3 business flows."</em>
                  </p>
                </div>
                <div className="wcard" style={{ cursor: "default" }}>
                  <h3>Why it helps</h3>
                  <p>Before you change a function, see exactly what else might break. Before you commit, see the real risk — not a guess. Search visually in the Graph tab instead of grepping.</p>
                </div>
                <div className="wcard" style={{ cursor: "default" }}>
                  <h3>Is my code uploaded?</h3>
                  <p>No. Everything runs and stays on this machine — analysis, the index, and the graph explorer all bind to localhost only.</p>
                </div>
              </div>
            )}

            <EmptyState>
              {mode === "repos"
                ? repos.length === 0
                  ? 'Click "+ Add" on the left to discover and analyze your first repository — takes a few seconds to a few minutes depending on its size.'
                  : "Select a repository on the left to explore it."
                : 'Click "+ Create" to group related repositories (e.g. a frontend and its backend) into a workspace.'}
            </EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
