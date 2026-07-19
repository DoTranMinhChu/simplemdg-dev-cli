import type { TNexusRiskLevel, TNexusStatus } from "../../../../api/nexus-api-types";

const STATUS_LABELS: Record<TNexusStatus, string> = {
  ready: "Ready",
  "setup-required": "Setup required",
  "index-required": "Needs analysis",
  "update-required": "Out of date",
  analyzing: "Analyzing",
  error: "Failed",
};

const STATUS_CLASSES: Record<TNexusStatus, string> = {
  ready: "ready",
  "setup-required": "needs-analysis",
  "index-required": "needs-analysis",
  "update-required": "out-of-date",
  analyzing: "analyzing",
  error: "failed",
};

export function RepoStatusBadge({ status }: { status: TNexusStatus }): React.ReactElement {
  return <span className={`status-badge ${STATUS_CLASSES[status]}`}>{STATUS_LABELS[status]}</span>;
}

const RISK_LABELS: Record<TNexusRiskLevel, string> = { low: "Low risk", medium: "Medium risk", high: "High risk", unknown: "Unknown risk" };
const RISK_CLASSES: Record<TNexusRiskLevel, string> = { low: "ready", medium: "out-of-date", high: "failed", unknown: "needs-analysis" };

/**
 * Risk level is ALWAYS rendered together with its reason sentence — there is
 * no code path that shows a bare risk badge, per the product requirement to
 * never show a risk number/level without an explanation.
 */
export function RiskBadge({ risk, reason }: { risk: TNexusRiskLevel; reason: string }): React.ReactElement {
  return (
    <div className="nexus-risk-row">
      <span className={`status-badge ${RISK_CLASSES[risk]}`}>{RISK_LABELS[risk]}</span>
      <span className="note">{reason}</span>
    </div>
  );
}

export function SuggestionBadge({ suggested = true }: { suggested?: boolean }): React.ReactElement {
  return <span className="pill">{suggested ? "Suggested" : "Confirmed"}</span>;
}
