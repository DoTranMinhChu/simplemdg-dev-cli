import { EmptyState } from "../../components/common/EmptyState";
import { SessionNavigator } from "./components/SessionNavigator";
import { SessionWorkspace } from "./components/SessionWorkspace";
import { AiToastStack } from "./components/AiToastStack";
import { useAiStudioStore } from "./state/ai-studio-store";

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

export function AiStudioPage(): React.ReactElement {
  const { overview, selectedSessionId } = useAiStudioStore();

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand">
          SimpleMDG <span className="b2">AI Studio</span>
        </span>
        {overview ? (
          <>
            <span className="badge on">{overview.totalSessions} sessions</span>
            <span className="badge">{formatTokens(overview.totalTokens)} tokens</span>
            <span className="badge">{formatDuration(overview.totalDurationMs)} agent time</span>
            <span className="badge">{overview.totalToolCalls} tool calls</span>
            {overview.totalErrors > 0 ? <span className="badge prod">{overview.totalErrors} errors</span> : null}
          </>
        ) : null}
        <span className="grow" />
        <span className="note faint">Local only · 127.0.0.1</span>
      </header>
      <div className="main-layout">
        <aside className="sidebar">
          <SessionNavigator />
        </aside>
        <div className="workspace">
          {selectedSessionId ? (
            <SessionWorkspace sessionId={selectedSessionId} />
          ) : (
            <div className="welcome">
              <h1>AI Studio</h1>
              <div className="lede">Local observability for your Claude Code and Codex sessions — select a session on the left to inspect it.</div>
              <EmptyState>Pick a session from the sidebar, or click Refresh if you don't see recent activity yet.</EmptyState>
            </div>
          )}
        </div>
      </div>
      <footer className="statusbar">
        <span className="st-item faint">Sessions and observations never leave this machine. Secrets are redacted by default.</span>
      </footer>
      <AiToastStack />
    </div>
  );
}
