import { useEffect, useState } from "react";
import { Button } from "../../../../components/common/Button";
import { EmptyState } from "../../../../components/common/EmptyState";
import { nexusApi } from "../../../../api/nexus-api-client";
import type { TNexusOverviewResponse, TNexusRepoSummary } from "../../../../api/nexus-api-types";
import { NexusUnavailableBanner } from "../components/NexusUnavailableBanner";
import { SuggestedNextActions } from "../components/SuggestedNextActions";

export function ProjectOverviewTab({ repo, onOpenGraph, onOpenInVsCode }: { repo: TNexusRepoSummary; onOpenGraph: () => void; onOpenInVsCode: () => void }): React.ReactElement {
  const [response, setResponse] = useState<TNexusOverviewResponse | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    nexusApi
      .getOverview(repo.path)
      .then((result) => !cancelled && setResponse(result))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repo.path]);

  if (loading) {
    return (
      <EmptyState>
        <span className="spin" /> Loading overview...
      </EmptyState>
    );
  }

  if (!response || response.status === "error" || !response.overview) {
    return <NexusUnavailableBanner message={response?.message ?? "Overview isn't available for this repository yet."} />;
  }

  const { overview } = response;

  return (
    <div className="tabpane-scroll">
      {response.status && response.status !== "ready" ? <NexusUnavailableBanner message={response.message ?? ""} /> : null}

      <div className="ai-card">
        <h3>{repo.name}</h3>
        <div className="kvs">
          <div>
            <span className="k">Branch</span>
            {overview.branch ?? "unknown"}
          </div>
          <div>
            <span className="k">Analyzed</span>
            {overview.indexedAt ?? "unknown"}
            {overview.upToDate === false ? <span className="note" style={{ color: "var(--amber)", marginLeft: 6 }}>(out of date)</span> : null}
          </div>
          <div>
            <span className="k">Path</span>
            <span className="note faint">{repo.path}</span>
          </div>
        </div>
      </div>

      {overview.stats && (
        <div className="ai-card">
          <h3>What's in this project</h3>
          <div className="nexus-stat-grid">
            <div className="nexus-stat-tile">
              <div className="nexus-stat-value">{overview.stats.files}</div>
              <div className="nexus-stat-label">Files analyzed</div>
            </div>
            <div className="nexus-stat-tile">
              <div className="nexus-stat-value">{overview.stats.symbols}</div>
              <div className="nexus-stat-label">Functions &amp; classes</div>
            </div>
            <div className="nexus-stat-tile">
              <div className="nexus-stat-value">{overview.stats.edges}</div>
              <div className="nexus-stat-label">Dependencies traced</div>
            </div>
            <div className="nexus-stat-tile">
              <div className="nexus-stat-value">{overview.stats.processes}</div>
              <div className="nexus-stat-label">Execution flows found</div>
            </div>
          </div>
        </div>
      )}

      <div className="ai-card">
        <h3>Where to start</h3>
        <p className="note">Explore this project's structure, dependencies, and execution flows visually in GitNexus's graph explorer.</p>
        <Button size="sm" onClick={onOpenGraph}>
          Open graph explorer
        </Button>
      </div>

      <SuggestedNextActions
        actions={[
          { label: "Open graph explorer", onClick: onOpenGraph },
          { label: "Open in VS Code", onClick: onOpenInVsCode },
        ]}
      />
    </div>
  );
}
