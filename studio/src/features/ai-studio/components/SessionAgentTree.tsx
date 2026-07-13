import { formatDuration, formatTokens, shortModelLabel } from "../format";
import type { TAiSession, TSessionAdvisor } from "../../../api/ai-studio-api-types";

/** Whole-session orchestration tree: the main session (synthetic root) plus each sub-agent it
 *  spawned, nested one level deep. Distinct from the per-turn Graph view (graph/SessionGraph.tsx),
 *  which shows one turn's observation tree — this shows the whole session's agent hierarchy at a
 *  glance. "running" is approximated from recent activity, not a true live signal (see
 *  ai-session-advisor.ts). */
export function SessionAgentTree({ session, advisor }: { session: TAiSession; advisor: TSessionAdvisor }): React.ReactElement | null {
  if (advisor.neutral) return null;
  const runningCount = advisor.agents.filter((agent) => agent.status === "running").length;

  return (
    <div className="ai-card">
      <h3>
        Orchestration{" "}
        {runningCount > 0 ? (
          <span className="ai-tree-live">
            <span className="ai-tree-live-dot" /> {runningCount} running
          </span>
        ) : (
          <span className="ai-adv-count">{advisor.agents.length}</span>
        )}
      </h3>
      {advisor.agents.length === 0 ? (
        <div className="note">No sub-agents spawned in this session.</div>
      ) : (
        <div className="ai-tree">
          <div className="ai-tree-row">
            <span className="ai-tree-glyph" aria-hidden="true">
              ✓
            </span>
            <span className="ai-tree-dot" style={{ background: "var(--a0)" }} />
            <span className="ai-tree-name">main</span>
            <span className="ai-tree-meta">
              {formatDuration(session.durationMs)} · {formatTokens(session.inputTokens + session.outputTokens)}
            </span>
          </div>
          {advisor.agents.map((agent, index) => (
            <div className="ai-tree-row nested" key={agent.sessionId} style={{ paddingLeft: 16 * agent.depth }}>
              <span className="ai-tree-glyph" aria-hidden="true">
                {agent.status === "running" ? "▶" : "✓"}
              </span>
              <span className="ai-tree-dot" style={{ background: `var(--a${(index + 1) % 6})` }} />
              <span className="ai-tree-name" title={agent.type}>
                {agent.type}
              </span>
              <span className="ai-chip model">{shortModelLabel(agent.model)}</span>
              <span className="ai-tree-meta">
                {agent.status === "running" ? `${agent.toolCallCount} calls` : formatDuration(agent.durationMs)} · {formatTokens(agent.tokens)}
              </span>
              {agent.spawnReason ? (
                <div className="ai-tree-reason" title={agent.spawnReason}>
                  {agent.spawnReason}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
