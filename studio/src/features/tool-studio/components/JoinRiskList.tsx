import type { TJoinFieldRisk } from "../api/tool-studio-api-client";

const JOIN_RISK_SEVERITY_LABEL: Record<TJoinFieldRisk["severity"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  info: "Info",
};

const SEVERITY_ORDER: Record<TJoinFieldRisk["severity"], number> = { critical: 0, high: 1, medium: 2, info: 3 };

/**
 * Renders `joinRisks` (see `csn-model-types.ts`), most severe first — extracted from
 * `DeployModelPage`'s original inline block so `ManualModelEditor`'s own "Validate" step can show
 * the exact same warnings for the exact same reason (a composition whose join couldn't be
 * unambiguously derived), just with different framing text since there's no EDMX involved.
 */
export function JoinRiskList({ risks, note }: { risks: TJoinFieldRisk[]; note: React.ReactNode }): React.ReactElement | null {
  if (!risks.length) return null;
  const sortedRisks = [...risks].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return (
    <div>
      <div className="note" style={{ marginBottom: 8 }}>
        {sortedRisks.length} composition join warning(s) — {note}
      </div>
      <div className="dm-risk-list">
        {sortedRisks.map((risk, index) => (
          <div key={index} className={`dm-risk ${risk.severity}`}>
            <span className="dm-risk-badge">{JOIN_RISK_SEVERITY_LABEL[risk.severity]}</span>
            <div className="dm-risk-body">
              <div className="dm-risk-title">
                {risk.parentBusinessTable}.{risk.relationName} → {risk.targetBusinessTable}.{risk.parentKeyField}
              </div>
              <div className="dm-risk-message">{risk.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
