import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Collapsible } from "../../../components/common/Collapsible";
import { EmptyState } from "../../../components/common/EmptyState";
import { JsonView } from "../../../components/common/JsonView";
import { nexusApi } from "../../../api/nexus-api-client";
import type { TNexusContract, TNexusRepoSummary, TNexusWorkspaceStatus } from "../../../api/nexus-api-types";
import { RiskBadge, SuggestionBadge } from "./components/NexusBadges";
import { NexusUnavailableBanner } from "./components/NexusUnavailableBanner";

type TProps = {
  workspaceName: string;
  analyzedRepos: TNexusRepoSummary[];
  toast: (message: string, kind?: "ok" | "err" | "warn") => void;
};

/**
 * Multi-repository workspace detail — wraps `gitnexus group`'s members,
 * contracts (auto-detected shared HTTP/package relationships between member
 * repos), and cross-repo search/impact. Contracts are always shown with a
 * "Suggested" badge — GitNexus detects them by matching, not by a confirmed
 * hand-authored link, so the product's "label uncertain relationships as
 * suggestions" rule applies here directly.
 */
export function WorkspaceDetailView({ workspaceName, analyzedRepos, toast }: TProps): React.ReactElement {
  const [status, setStatus] = useState<TNexusWorkspaceStatus | undefined>();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [newGroupPath, setNewGroupPath] = useState("");
  const [newRegistryName, setNewRegistryName] = useState("");
  const [contracts, setContracts] = useState<TNexusContract[] | undefined>();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPerRepo, setSearchPerRepo] = useState<Array<{ repo: string; count: number }> | undefined>();
  const [impactGroupPath, setImpactGroupPath] = useState("");
  const [impactTarget, setImpactTarget] = useState("");
  const [impactRunning, setImpactRunning] = useState(false);
  const [impactResult, setImpactResult] = useState<Awaited<ReturnType<typeof nexusApi.getWorkspaceImpact>> | undefined>();

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      setStatus(await nexusApi.getWorkspaceStatus(workspaceName));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
    setContracts(undefined);
    setSearchPerRepo(undefined);
    setImpactResult(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceName]);

  const addMember = async (): Promise<void> => {
    if (!newGroupPath.trim() || !newRegistryName.trim()) return;
    try {
      const result = await nexusApi.addRepoToWorkspace(workspaceName, newGroupPath.trim(), newRegistryName.trim());
      toast(result.message ?? "Added.", result.status === "error" ? "err" : "ok");
      setNewGroupPath("");
      setNewRegistryName("");
      void reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  const removeMember = async (groupPath: string): Promise<void> => {
    try {
      const result = await nexusApi.removeRepoFromWorkspace(workspaceName, groupPath);
      toast(result.message ?? "Removed.", result.status === "error" ? "err" : "ok");
      void reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      const result = await nexusApi.syncWorkspace(workspaceName);
      toast(result.message ?? "Synced.", result.status === "error" ? "err" : "ok");
      void reload();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setSyncing(false);
    }
  };

  const loadContracts = async (): Promise<void> => {
    try {
      const response = await nexusApi.getWorkspaceContracts(workspaceName);
      setContracts(response.contracts);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  const runSearch = async (): Promise<void> => {
    if (!searchQuery.trim()) return;
    try {
      const response = await nexusApi.searchWorkspaceFlows(workspaceName, searchQuery.trim());
      setSearchPerRepo(response.perRepo);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  const runImpact = async (): Promise<void> => {
    if (!impactGroupPath.trim() || !impactTarget.trim()) return;
    setImpactRunning(true);
    try {
      setImpactResult(await nexusApi.getWorkspaceImpact(workspaceName, impactGroupPath.trim(), impactTarget.trim()));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setImpactRunning(false);
    }
  };

  if (loading) {
    return (
      <EmptyState>
        <span className="spin" /> Loading workspace...
      </EmptyState>
    );
  }

  if (!status || status.status === "error") {
    return <NexusUnavailableBanner message={status?.message ?? "Couldn't load this workspace."} onRetry={reload} />;
  }

  return (
    <div className="tabpane-scroll">
      <div className="ai-card">
        <h3>
          {workspaceName} <span className="note faint">{status.synced ? "synced" : "not synced yet"}</span>
        </h3>

        {status.members.length === 0 ? (
          <div className="note faint">No repositories in this workspace yet — add one below.</div>
        ) : (
          <div className="nexus-workspace-members">
            {status.members.map((member) => (
              <div key={member.groupPath} className="nexus-workspace-member-row">
                <span className="nexus-repo-row-name">{member.groupPath}</span>
                <span className="note faint">index: {member.indexStatus}</span>
                <span className="note faint">contracts: {member.contractsStatus}</span>
                <Button size="sm" variant="ghost" onClick={() => removeMember(member.groupPath)}>
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <input className="input" placeholder="Path within workspace, e.g. backend" value={newGroupPath} onChange={(event) => setNewGroupPath(event.target.value)} style={{ flex: "1 1 160px" }} />
          <select className="input" style={{ flex: "1 1 160px" }} value={newRegistryName} onChange={(event) => setNewRegistryName(event.target.value)}>
            <option value="">Pick an analyzed repository...</option>
            {analyzedRepos.map((repo) => (
              <option key={repo.name} value={repo.name}>
                {repo.name}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={addMember} disabled={!newGroupPath.trim() || !newRegistryName.trim()}>
            Add
          </Button>
        </div>

        <div className="row" style={{ marginTop: 10 }}>
          <Button size="sm" variant="ghost" onClick={sync} disabled={syncing || status.members.length === 0}>
            {syncing ? "Syncing..." : "Sync (rebuild shared-package/API links)"}
          </Button>
        </div>
      </div>

      <div className="ai-card">
        <Collapsible summary="Shared package & API relationships (contracts)" defaultOpen={false}>
          {!contracts ? (
            <Button size="sm" onClick={loadContracts}>
              Load contracts
            </Button>
          ) : contracts.length === 0 ? (
            <div className="note faint">No shared contracts detected yet. Run Sync first if you haven't.</div>
          ) : (
            <div className="nexus-contracts-list">
              {contracts.map((contract, index) => (
                <div key={index} className="nexus-contract-row">
                  <span className="pill">{contract.direction}</span>
                  <span className="note" style={{ flex: 1 }}>
                    {contract.key}
                  </span>
                  <span className="note faint">{contract.repo}</span>
                  <SuggestionBadge />
                </div>
              ))}
            </div>
          )}
        </Collapsible>
      </div>

      <div className="ai-card">
        <h3>Search across this workspace</h3>
        <div className="row" style={{ gap: 6 }}>
          <input className="input" style={{ flex: 1 }} placeholder="Search term" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          <Button size="sm" onClick={runSearch} disabled={!searchQuery.trim()}>
            Search
          </Button>
        </div>
        {searchPerRepo && (
          <div style={{ marginTop: 8 }}>
            {searchPerRepo.every((entry) => entry.count === 0) ? (
              <div className="note faint">No matches in any member repository for this term.</div>
            ) : (
              searchPerRepo.map((entry) => (
                <div key={entry.repo} className="note">
                  {entry.repo}: {entry.count} match(es)
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="ai-card">
        <h3>Cross-repo impact</h3>
        <p className="note">See which other repositories in this workspace could be affected by changing a symbol in one member.</p>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <select className="input" value={impactGroupPath} onChange={(event) => setImpactGroupPath(event.target.value)} style={{ flex: "1 1 140px" }}>
            <option value="">Member repo...</option>
            {status.members.map((member) => (
              <option key={member.groupPath} value={member.groupPath}>
                {member.groupPath}
              </option>
            ))}
          </select>
          <input className="input" placeholder="Function or class name" value={impactTarget} onChange={(event) => setImpactTarget(event.target.value)} style={{ flex: "1 1 160px" }} />
          <Button size="sm" onClick={runImpact} disabled={impactRunning || !impactGroupPath || !impactTarget.trim()}>
            {impactRunning ? "Analyzing..." : "Analyze"}
          </Button>
        </div>
        {impactResult && (
          <div style={{ marginTop: 10 }}>
            {impactResult.status === "error" ? (
              <NexusUnavailableBanner message={impactResult.message ?? "Impact analysis failed."} />
            ) : (
              <>
                <RiskBadge
                  risk={impactResult.risk}
                  reason={`${impactResult.directCount} direct caller(s), ${impactResult.processesAffected} flow(s) affected, ${impactResult.crossRepoHits} cross-repo hit(s).`}
                />
                {impactResult.crossRepoHits === 0 && (
                  <div className="note faint" style={{ marginTop: 6 }}>
                    No confirmed cross-repo relationships yet for this symbol — this may still be accurate if it's genuinely only used within this repo, or the workspace may need syncing.
                  </div>
                )}
                <Collapsible summary="Raw cross-repo data (advanced)">
                  <JsonView value={impactResult.crossRepoRaw} />
                </Collapsible>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
