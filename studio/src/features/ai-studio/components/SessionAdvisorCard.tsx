import { Icon } from "../../../components/common/Icon";
import { useAiStudioStore } from "../state/ai-studio-store";
import type { TAdvisorRecommendation, TSessionAdvisor } from "../../../api/ai-studio-api-types";

function gradeSeverity(grade: string): "good" | "warn" | "crit" {
  if (grade === "A" || grade === "B") return "good";
  if (grade === "C" || grade === "D") return "warn";
  return "crit";
}

function dimensionSeverity(score: number): "good" | "warn" | "crit" {
  if (score >= 75) return "good";
  if (score >= 50) return "warn";
  return "crit";
}

/** Wraps a recommendation as an instruction addressed to Claude, so pasting it straight into a
 *  Claude Code chat reads as a request rather than a note the user wrote to themselves. */
function buildPrompt(recommendation: TAdvisorRecommendation): string {
  const head = recommendation.metric ? `${recommendation.title} (${recommendation.metric})` : recommendation.title;
  const parts = [`Efficiency Advisor tip: ${head}`];
  if (recommendation.detail) parts.push(recommendation.detail);
  parts.push("Please help me apply this to my current session.");
  return parts.join("\n\n");
}

/** Efficiency Advisor: grade + dimension breakdown + ranked, copyable recommendations. Hidden
 *  entirely when `advisor.neutral` — a fresh/tiny session hasn't done enough to score, and
 *  showing a grade anyway would read as signal where there isn't any. */
export function SessionAdvisorCard({ advisor }: { advisor: TSessionAdvisor }): React.ReactElement | null {
  const { toast } = useAiStudioStore();
  if (advisor.neutral) return null;

  const copyPrompt = (recommendation: TAdvisorRecommendation): void => {
    navigator.clipboard.writeText(buildPrompt(recommendation));
    toast("Copied prompt to clipboard");
  };

  const criticalCount = advisor.recommendations.filter((recommendation) => recommendation.severity === "critical").length;
  const countLabel =
    advisor.recommendations.length === 0
      ? "all clear"
      : criticalCount > 0
        ? `${criticalCount} critical · ${advisor.recommendations.length} total`
        : `${advisor.recommendations.length} tip${advisor.recommendations.length === 1 ? "" : "s"}`;

  return (
    <div className="ai-card">
      <h3>
        Advisor <span className="ai-adv-count">{countLabel}</span>
      </h3>
      <div className="ai-adv-score">
        <span className={`ai-adv-grade ${gradeSeverity(advisor.grade)}`} title={`Efficiency score ${advisor.score}/100`}>
          {advisor.grade}
        </span>
        <div className="ai-adv-score-body">
          <div className="ai-adv-score-num">
            {advisor.score}
            <em>/100</em>
          </div>
          <div className="ai-adv-dims">
            {advisor.dimensions.map((dimension) => (
              <div className="ai-adv-dim" key={dimension.label} title={`${dimension.label}: ${dimension.score}/100`}>
                <span className="ai-adv-dim-label">{dimension.label}</span>
                <span className="ai-adv-dim-track">
                  <span className={`ai-adv-dim-fill ${dimensionSeverity(dimension.score)}`} style={{ width: `${Math.max(0, Math.min(100, dimension.score))}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {advisor.recommendations.length ? (
        <div className="ai-adv-recs">
          {advisor.recommendations.map((recommendation, index) => (
            <div className={`ai-adv-rec sev-${recommendation.severity}`} key={index}>
              <div className="ai-adv-rec-head">
                <span className="ai-adv-rec-cat">{recommendation.category}</span>
                <span className="ai-adv-rec-title">{recommendation.title}</span>
                {recommendation.metric ? <span className="ai-adv-rec-metric">{recommendation.metric}</span> : null}
                <button type="button" className="ai-adv-rec-copy" onClick={() => copyPrompt(recommendation)} title="Copy as a prompt">
                  <Icon name="copy" /> Copy
                </button>
              </div>
              <div className="ai-adv-rec-detail">{recommendation.detail}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="note">No efficiency issues detected.</div>
      )}
    </div>
  );
}
