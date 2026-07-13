import { useAiStudioStore } from "../state/ai-studio-store";
import { ContinueWorkingWidget } from "../components/ContinueWorkingWidget";

function formatDuration(ms: number): string {
  if (!ms) return "0h";
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.round((ms % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

/** The dashboard home: today's numbers, then a one-or-two-click way back into recent/pinned work. */
export function AiOverviewPage(): React.ReactElement {
  const { overview } = useAiStudioStore();

  return (
    <div className="ai-page">
      <div className="ai-page-head">
        <h1>Overview</h1>
        <div className="lede">Local observability for your Claude Code and Codex sessions.</div>
      </div>

      {overview ? (
        <div className="ai-metrics-bar ai-metrics-bar-page">
          <div className="ai-metric">
            <span className="ai-metric-label">Sessions</span>
            <span className="ai-metric-value">{overview.totalSessions}</span>
          </div>
          <div className="ai-metric">
            <span className="ai-metric-label">Tokens</span>
            <span className="ai-metric-value">{formatTokens(overview.totalTokens)}</span>
          </div>
          <div className="ai-metric">
            <span className="ai-metric-label">Agent time</span>
            <span className="ai-metric-value">{formatDuration(overview.totalDurationMs)}</span>
          </div>
          <div className="ai-metric">
            <span className="ai-metric-label">Tool calls</span>
            <span className="ai-metric-value">{overview.totalToolCalls}</span>
          </div>
          <div className="ai-metric">
            <span className="ai-metric-label">Errors</span>
            <span className={`ai-metric-value${overview.totalErrors > 0 ? " danger" : ""}`}>{overview.totalErrors}</span>
          </div>
        </div>
      ) : null}

      <ContinueWorkingWidget />
    </div>
  );
}
