import { formatTokens } from "../format";
import type { TSessionAdvisor } from "../../../api/ai-studio-api-types";

const PALETTE = ["--a0", "--a1", "--a2", "--a3", "--a4", "--a5"];

function paletteColor(index: number): string {
  return `var(${PALETTE[index % PALETTE.length]})`;
}

/** Higher cache reuse is better — inverted from the usual "high percent = bad" meter reading. */
function reuseSeverity(percent: number): "good" | "warn" | "crit" {
  if (percent >= 70) return "good";
  if (percent >= 40) return "warn";
  return "crit";
}

function LegendRow({ entries }: { entries: Array<{ label: string; tokens: number }> }): React.ReactElement {
  return (
    <div className="ai-econ-legend">
      {entries.map((entry, index) => (
        <span className="ai-econ-legend-item" key={`${entry.label}-${index}`}>
          <span className="ai-econ-legend-dot" style={{ background: paletteColor(index) }} />
          {entry.label} <b>{formatTokens(entry.tokens)}</b>
        </span>
      ))}
    </div>
  );
}

/** Whole-session token spend broken down by agent (main + each sub-agent) and by model, plus a
 *  cache-reuse summary. Sourced from the same /advisor payload as SessionAdvisorCard. */
export function SessionEconomicsCard({ advisor }: { advisor: TSessionAdvisor }): React.ReactElement | null {
  const economics = advisor.tokenEconomics;
  if (advisor.neutral || economics.totalTokens === 0) return null;

  return (
    <div className="ai-card">
      <h3>Token economics</h3>
      <div className="ai-econ-total">
        {formatTokens(economics.totalTokens)} <u>tokens</u>
      </div>
      {economics.totalTokens > 0 ? (
        <div className="ai-econ-bar">
          {economics.byAgent.map((entry, index) => (
            <span
              key={`${entry.label}-${index}`}
              className="ai-econ-bar-seg"
              style={{ width: `${(entry.tokens / economics.totalTokens) * 100}%`, background: paletteColor(index) }}
              title={`${entry.label}: ${formatTokens(entry.tokens)}`}
            />
          ))}
        </div>
      ) : null}
      <LegendRow entries={economics.byAgent} />
      {economics.byModel.length > 1 ? (
        <>
          <div className="ai-adv-count">by model</div>
          <LegendRow entries={economics.byModel} />
        </>
      ) : null}
      {economics.cacheReusePercent !== undefined ? (
        <div className="ai-econ-cache" title={`${formatTokens(economics.cacheReadTokens)} reused vs ${formatTokens(economics.cacheCreationTokens)} freshly cached`}>
          <div className="ai-scard-meter-track">
            <div className={`ai-scard-meter-fill ${reuseSeverity(economics.cacheReusePercent)}`} style={{ width: `${economics.cacheReusePercent}%` }} />
          </div>
          <span className="ai-econ-cache-label">
            {economics.cacheReusePercent}% from cache · {formatTokens(economics.cacheReadTokens)} reused
          </span>
        </div>
      ) : null}
    </div>
  );
}
