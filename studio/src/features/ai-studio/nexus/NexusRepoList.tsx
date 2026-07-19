import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { SearchInput } from "../../../components/common/SearchInput";
import { Collapsible } from "../../../components/common/Collapsible";
import { nexusApi } from "../../../api/nexus-api-client";
import type { TDiscoveredRepo, TNexusRepoSummary } from "../../../api/nexus-api-types";
import { RepoStatusBadge } from "./components/NexusBadges";

type TProps = {
  repos: TNexusRepoSummary[];
  selectedPath: string | undefined;
  onSelect: (path: string) => void;
  onChanged: () => void;
  toast: (message: string, kind?: "ok" | "err" | "warn") => void;
};

/**
 * Repository sidebar: type-to-search list + an inline "Add repository" panel
 * (discover nested git repos under a folder, multi-pick, analyze) — a single
 * page section rather than a separate modal/wizard, since the whole flow is
 * three short steps that fit comfortably inline.
 */
export function NexusRepoList({ repos, selectedPath, onSelect, onChanged, toast }: TProps): React.ReactElement {
  const [filter, setFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [folder, setFolder] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<TDiscoveredRepo[]>([]);
  const [selectedForAnalyze, setSelectedForAnalyze] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);

  const filtered = repos.filter((repo) => !filter.trim() || repo.name.toLowerCase().includes(filter.toLowerCase()) || repo.path.toLowerCase().includes(filter.toLowerCase()));

  const runDiscover = async (): Promise<void> => {
    setDiscovering(true);
    try {
      const response = await nexusApi.discoverRepos(folder || ".");
      setDiscovered(response.repos);
      setSelectedForAnalyze(new Set(response.repos.map((repo) => repo.path)));
      if (!response.repos.length) toast("No git repositories found under that folder.", "warn");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setDiscovering(false);
    }
  };

  const runAnalyzeSelected = async (): Promise<void> => {
    setAnalyzing(true);
    let succeeded = 0;
    let failed = 0;
    for (const repoPath of selectedForAnalyze) {
      const result = await nexusApi.analyzeRepo(repoPath).catch((error) => ({ status: "error" as const, message: error instanceof Error ? error.message : String(error) }));
      if (result.status === "error") failed += 1;
      else succeeded += 1;
    }
    setAnalyzing(false);
    toast(`Analyzed ${succeeded} repositor${succeeded === 1 ? "y" : "ies"}${failed ? `, ${failed} failed` : ""}.`, failed ? "warn" : "ok");
    setDiscovered([]);
    setAddOpen(false);
    onChanged();
  };

  const toggleSelected = (repoPath: string): void => {
    setSelectedForAnalyze((prev) => {
      const next = new Set(prev);
      if (next.has(repoPath)) next.delete(repoPath);
      else next.add(repoPath);
      return next;
    });
  };

  return (
    <div className="nexus-repo-list">
      <div className="nexus-repo-list-head">
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter repositories..." />
        <Button size="sm" variant={addOpen ? "sec" : "primary"} onClick={() => setAddOpen((value) => !value)}>
          {addOpen ? "Close" : "+ Add"}
        </Button>
      </div>

      {addOpen && (
        <div className="ai-card nexus-add-repo-panel">
          <h3>Add repositories</h3>
          <div className="row" style={{ gap: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Parent folder (defaults to current directory)" value={folder} onChange={(event) => setFolder(event.target.value)} />
            <Button size="sm" onClick={runDiscover} disabled={discovering}>
              {discovering ? "Searching..." : "Discover"}
            </Button>
          </div>

          {discovered.length > 0 && (
            <>
              <div className="nexus-discovery-list">
                {discovered.map((repo) => (
                  <label key={repo.path} className="nexus-discovery-item">
                    <input type="checkbox" checked={selectedForAnalyze.has(repo.path)} onChange={() => toggleSelected(repo.path)} />
                    <span className="nexus-discovery-name">{repo.name}</span>
                    <span className="note faint">{repo.path}</span>
                  </label>
                ))}
              </div>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span className="note">{selectedForAnalyze.size} selected</span>
                <Button size="sm" onClick={runAnalyzeSelected} disabled={analyzing || selectedForAnalyze.size === 0}>
                  {analyzing ? "Analyzing..." : `Analyze ${selectedForAnalyze.size || ""}`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="nexus-repo-rows">
        {filtered.length === 0 ? (
          <div className="note faint" style={{ padding: 16 }}>
            {repos.length === 0 ? 'No repositories analyzed yet. Click "+ Add" to get started.' : "No repositories match your filter."}
          </div>
        ) : (
          filtered.map((repo) => (
            <div key={repo.path} className={`nexus-repo-row${selectedPath === repo.path ? " active" : ""}`} onClick={() => onSelect(repo.path)}>
              <div className="nexus-repo-row-main">
                <span className="nexus-repo-row-name">{repo.name}</span>
                <RepoStatusBadge status={repo.status} />
              </div>
              <div className="note faint nexus-repo-row-path">{repo.branch ? `${repo.branch} · ` : ""}{repo.path}</div>
            </div>
          ))
        )}
      </div>

      <Collapsible summary="Advanced">
        <div className="note faint" style={{ padding: "8px 4px" }}>
          Repositories are analyzed with GitNexus (a local code-intelligence engine). Analysis runs entirely on this machine — nothing is uploaded. Indexes live in a <code>.gitnexus/</code> folder inside each repository.
        </div>
      </Collapsible>
    </div>
  );
}
