import { SearchInput } from "../../../components/common/SearchInput";
import { EmptyState } from "../../../components/common/EmptyState";
import { Button } from "../../../components/common/Button";
import { useAiStudioStore } from "../state/ai-studio-store";
import type { TAiSession } from "../../../api/ai-studio-api-types";

function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

function providerLabel(provider: string): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "codex") return "Codex";
  return provider;
}

function SessionRow({ session, active, onClick }: { session: TAiSession; active: boolean; onClick: () => void }): React.ReactElement {
  return (
    <div className={`wli${active ? " active" : ""}`} onClick={onClick} title={session.title}>
      <b>{session.title || session.id}</b>
      <div className="note">
        {providerLabel(session.provider)} · {session.project}
        {session.gitBranch ? ` · ${session.gitBranch}` : ""}
      </div>
      <div className="note">
        {formatDuration(session.durationMs)} · {formatTokens(session.inputTokens + session.outputTokens)} tok · {session.toolCallCount} tools
        {session.errorCount > 0 ? <span style={{ color: "var(--red)" }}> · {session.errorCount} errors</span> : null}
      </div>
    </div>
  );
}

export function SessionNavigator(): React.ReactElement {
  const { sessions, sessionsLoading, sessionsError, nextCursor, filter, setFilter, loadMoreSessions, selectedSessionId, selectSession, refreshing, refreshAll } = useAiStudioStore();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="side-actions">
        <Button size="sm" onClick={refreshAll} disabled={refreshing}>
          {refreshing ? "Scanning…" : "⟳ Refresh"}
        </Button>
      </div>
      <SearchInput value={filter.search ?? ""} onChange={(value) => setFilter({ search: value })} placeholder="Search sessions..." />
      <div style={{ padding: "6px 8px" }}>
        <select className="select" value={filter.provider ?? ""} onChange={(event) => setFilter({ provider: event.target.value || undefined })}>
          <option value="">All providers</option>
          <option value="claude">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(filter.hasErrors)} onChange={(event) => setFilter({ hasErrors: event.target.checked || undefined })} />
          Errors only
        </label>
      </div>

      {sessionsError ? (
        <div className="errbox">{sessionsError}</div>
      ) : !sessions.length && !sessionsLoading ? (
        <EmptyState>No AI sessions found yet. Use Claude Code or Codex, then click Refresh.</EmptyState>
      ) : (
        <div style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} active={session.id === selectedSessionId} onClick={() => selectSession(session.id)} />
          ))}
          {sessionsLoading ? (
            <div className="tnote">
              <span className="spin" /> loading...
            </div>
          ) : null}
          {nextCursor && !sessionsLoading ? (
            <div className="row" style={{ padding: 8 }}>
              <Button size="sm" variant="ghost" onClick={loadMoreSessions}>
                Load more
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
