import { useEffect, useState } from "react";
import { EmptyState } from "../../../../components/common/EmptyState";
import { nexusApi } from "../../../../api/nexus-api-client";
import type { TNexusSessionComparison } from "../../../../api/nexus-api-types";
import { RiskBadge } from "../components/NexusBadges";
import { NexusUnavailableBanner } from "../components/NexusUnavailableBanner";

/**
 * "Did the AI agent inspect enough of the project before changing the code?"
 * Cross-references files the agent read/edited (already computed by AI
 * Studio's own session analysis) against what GitNexus currently reports as
 * changed in that same repo — concrete findings, not a vague score.
 */
export function SessionCodeIntelTab({ sessionId }: { sessionId: string }): React.ReactElement {
  const [comparison, setComparison] = useState<TNexusSessionComparison | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    nexusApi
      .getSessionComparison(sessionId)
      .then((result) => !cancelled && setComparison(result))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loading) {
    return (
      <EmptyState>
        <span className="spin" /> Comparing against Code Intelligence...
      </EmptyState>
    );
  }

  if (!comparison || comparison.status === "index-required" || comparison.status === "error" || !comparison.repo) {
    return (
      <div className="tabpane-scroll">
        <NexusUnavailableBanner message={comparison?.message ?? "This project hasn't been analyzed by Code Intelligence yet."} />
        <div className="note faint" style={{ padding: 10 }}>
          Session files, verification, and every other tab remain available — only dependency and execution-flow comparison require analyzing this project first.
        </div>
      </div>
    );
  }

  return (
    <div className="tabpane-scroll">
      <div className="ai-card">
        <h3>Without Code Intelligence</h3>
        <div className="kvs">
          <div>
            <span className="k">Files touched</span>
            {comparison.agentTouchedFiles.length}
          </div>
        </div>
      </div>

      <div className="ai-card">
        <h3>With Code Intelligence</h3>
        <RiskBadge risk={comparison.risk} reason={comparison.summary} />
        <div className="kvs" style={{ marginTop: 8 }}>
          <div>
            <span className="k">GitNexus-flagged files</span>
            {comparison.gitNexusAffectedFiles.length}
          </div>
          <div>
            <span className="k">Affected execution flows</span>
            {comparison.affectedProcessCount}
          </div>
        </div>

        {comparison.missedFiles.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="k" style={{ marginBottom: 4, color: "var(--amber)" }}>
              Not inspected this session
            </div>
            {comparison.missedFiles.map((file) => (
              <div key={file} className="note">
                - {file}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
