import { EmptyState } from "../../../components/common/EmptyState";
import { formatDuration } from "../format";
import { ToolCallDetail } from "../conversation/ToolCallDetail";
import type { TAiObservation, TVerificationCheck } from "../../../api/ai-studio-api-types";

function statusIcon(status: TVerificationCheck["status"]): string {
  if (status === "pass") return "✓";
  if (status === "fail") return "✗";
  if (status === "partial") return "⚠";
  return "?";
}

/** §21/§20 — analysis.verification, already computed server-side; click-through to the originating command. */
export function VerificationView({ verification, observations }: { verification: TVerificationCheck[]; observations: TAiObservation[] }): React.ReactElement {
  if (!verification.length) return <EmptyState>No verification commands (typecheck/build/test/lint) were observed in this session.</EmptyState>;

  return (
    <div className="verification-view">
      {verification.map((check, index) => {
        const observation = observations.find((candidate) => candidate.id === check.observationId);
        return (
          <div key={index} className="ai-card" style={{ marginBottom: 10 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <span className={`badge${check.status === "fail" ? " err" : check.status === "pass" ? " on" : ""}`}>
                  {statusIcon(check.status)} {check.label}
                </span>
              </div>
              {check.durationMs ? <span className="note">{formatDuration(check.durationMs)}</span> : null}
            </div>
            {observation ? (
              <div style={{ marginTop: 10 }}>
                <ToolCallDetail observation={observation} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
