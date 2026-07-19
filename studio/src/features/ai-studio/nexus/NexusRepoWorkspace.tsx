import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { nexusApi } from "../../../api/nexus-api-client";
import type { TNexusRepoSummary } from "../../../api/nexus-api-types";
import { RepoStatusBadge } from "./components/NexusBadges";
import { NexusUnavailableBanner } from "./components/NexusUnavailableBanner";
import { AgentsTab } from "./tabs/AgentsTab";
import { GraphTab } from "./tabs/GraphTab";
import { ImpactAnalysisTab } from "./tabs/ImpactAnalysisTab";
import { ProjectOverviewTab } from "./tabs/ProjectOverviewTab";

type TTabKind = "overview" | "graph" | "impact" | "agents";
const TABS: Array<{ kind: TTabKind; label: string }> = [
  { kind: "overview", label: "Overview" },
  { kind: "graph", label: "Graph" },
  { kind: "impact", label: "Change Impact" },
  { kind: "agents", label: "AI Agents" },
];

export function NexusRepoWorkspace({
  repo,
  onChanged,
  toast,
}: {
  repo: TNexusRepoSummary;
  onChanged: () => void;
  toast: (message: string, kind?: "ok" | "err" | "warn") => void;
}): React.ReactElement {
  const [tab, setTab] = useState<TTabKind>("overview");
  const [busy, setBusy] = useState(false);

  const analyze = async (force: boolean): Promise<void> => {
    setBusy(true);
    try {
      const result = await nexusApi.analyzeRepo(repo.path, { force });
      toast(result.message ?? "Analyzed.", result.status === "error" ? "err" : "ok");
      onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await nexusApi.removeRepo(repo.name);
      toast(result.message ?? "Removed.", result.status === "error" ? "err" : "ok");
      onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setBusy(false);
    }
  };

  const openInVsCode = (): void => {
    void nexusApi.openInVsCode(repo.path);
  };

  return (
    <div className="tabpane">
      <div className="row" style={{ padding: "10px 10px 0", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <strong>{repo.name}</strong>
          <RepoStatusBadge status={repo.status} />
        </div>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="ghost" onClick={openInVsCode}>
            Open in VS Code
          </Button>
          <Button size="sm" variant="ghost" onClick={() => analyze(repo.status !== "index-required")} disabled={busy}>
            {repo.status === "index-required" ? "Analyze" : "Re-analyze"}
          </Button>
          <Button size="sm" variant="danger" onClick={remove} disabled={busy}>
            Remove
          </Button>
        </div>
      </div>

      {repo.status !== "ready" ? <div style={{ padding: "8px 10px 0" }}><NexusUnavailableBanner message={repo.message} /></div> : null}

      <div className="tabbar-row">
        <div className="tabbar">
          {TABS.map((item) => (
            <div key={item.kind} className={`wtab${tab === item.kind ? " active" : ""}`} onClick={() => setTab(item.kind)}>
              <span className="t-title">{item.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="pane-body">
        {tab === "overview" ? (
          <ProjectOverviewTab repo={repo} onOpenGraph={() => setTab("graph")} onOpenInVsCode={openInVsCode} />
        ) : tab === "graph" ? (
          <GraphTab repo={repo} />
        ) : tab === "impact" ? (
          <ImpactAnalysisTab repo={repo} />
        ) : (
          <AgentsTab repo={repo} toast={toast} />
        )}
      </div>
    </div>
  );
}
