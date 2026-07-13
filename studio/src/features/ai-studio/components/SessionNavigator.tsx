import { useState } from "react";
import { SearchInput } from "../../../components/common/SearchInput";
import { EmptyState } from "../../../components/common/EmptyState";
import { Button } from "../../../components/common/Button";
import { ContextMenu, type TContextMenuState } from "../../../components/common/ContextMenu";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { useAiStudioStore } from "../state/ai-studio-store";
import { useSessionResume } from "../use-session-resume";
import { useVirtualList } from "../use-virtual-list";
import { LaunchConfirmModal } from "./LaunchConfirmModal";
import { SessionRow } from "./SessionRow";
import { ProjectPicker } from "./ProjectPicker";
import { ProviderChip } from "./ProviderChip";
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

export function SessionNavigator(): React.ReactElement {
  const { sessions, sessionsLoading, sessionsError, nextCursor, filter, setFilter, loadMoreSessions, selectedSessionId, selectSession, refreshing, refreshAll, toast, patchSession } =
    useAiStudioStore();
  const { pending, requestLaunch, confirmPending, cancelPending } = useSessionResume(toast);
  const [menu, setMenu] = useState<(TContextMenuState & { session: TAiSession }) | undefined>();
  const { containerRef, firstRowRef, window: virtualWindow } = useVirtualList(sessions.length);

  const copy = (text: string, label: string): void => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
  };

  const togglePinned = (session: TAiSession): void => {
    const next = !session.pinned;
    patchSession(session.id, { pinned: next });
    aiStudioApi.setPinned(session.id, next);
  };

  const openProject = async (session: TAiSession): Promise<void> => {
    const result = await aiStudioApi.openProject(session.id);
    if (!result.ok) toast(result.error ?? "Failed to open the project folder.", "err");
  };

  const openVsCode = async (session: TAiSession): Promise<void> => {
    const result = await aiStudioApi.openVsCode(session.id);
    if (!result.ok) toast(result.error ?? "VS Code command-line launcher not found.", "err");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div className="side-actions">
        <Button size="sm" onClick={refreshAll} disabled={refreshing}>
          {refreshing ? "Scanning…" : "⟳ Refresh"}
        </Button>
      </div>
      <SearchInput value={filter.search ?? ""} onChange={(value) => setFilter({ search: value })} placeholder="Search sessions..." />
      <div style={{ padding: "6px 8px" }}>
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          <ProjectPicker value={filter.project} onChange={(project) => setFilter({ project })} />
          <select className="select ai-select" value={filter.provider ?? ""} onChange={(event) => setFilter({ provider: event.target.value || undefined })}>
            <option value="">All providers</option>
            <option value="claude">Claude Code</option>
            <option value="codex">Codex</option>
          </select>
        </div>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(filter.hasErrors)} onChange={(event) => setFilter({ hasErrors: event.target.checked || undefined })} />
          Errors only
        </label>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
          <input type="checkbox" checked={Boolean(filter.pinnedOnly)} onChange={(event) => setFilter({ pinnedOnly: event.target.checked || undefined })} />
          Pinned only
        </label>
      </div>

      {sessionsError ? (
        <div className="errbox">{sessionsError}</div>
      ) : !sessions.length && !sessionsLoading ? (
        <EmptyState>No AI sessions found yet. Use Claude Code or Codex, then click Refresh.</EmptyState>
      ) : (
        <div className="wlist" ref={containerRef} style={{ overflow: "auto", flex: 1, minHeight: 0 }}>
          {virtualWindow.topPadding > 0 ? <div style={{ height: virtualWindow.topPadding }} /> : null}
          {sessions.slice(virtualWindow.startIndex, virtualWindow.endIndex).map((session, sliceIndex) => (
            <SessionRow
              key={session.id}
              ref={virtualWindow.startIndex === 0 && sliceIndex === 0 ? firstRowRef : undefined}
              session={session}
              active={session.id === selectedSessionId}
              onClick={() => selectSession(session.id)}
              onResume={(event) => {
                event.stopPropagation();
                requestLaunch(session, "resume");
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setMenu({ x: event.clientX, y: event.clientY, session, items: [] });
              }}
              meta={
                <>
                  <ProviderChip provider={session.provider} /> {session.project}
                  {session.gitBranch ? ` · ${session.gitBranch}` : ""} · {formatDuration(session.durationMs)} · {formatTokens(session.inputTokens + session.outputTokens)} tok ·{" "}
                  {session.toolCallCount} tools
                  {session.errorCount > 0 ? <span className="ai-row-error"> · {session.errorCount} errors</span> : null}
                </>
              }
            />
          ))}
          {virtualWindow.bottomPadding > 0 ? <div style={{ height: virtualWindow.bottomPadding }} /> : null}
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

      {menu ? (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(undefined)}
          items={[
            { label: "Resume in Claude Code", icon: "play", onClick: () => requestLaunch(menu.session, "resume") },
            { label: "Continue Latest Session in Project", icon: "play", onClick: () => requestLaunch(menu.session, "continue") },
            { sep: true },
            { label: menu.session.pinned ? "Unpin Session" : "Pin Session", icon: "pin", onClick: () => togglePinned(menu.session) },
            { sep: true },
            { label: "Copy Session ID", icon: "copy", onClick: () => copy(menu.session.id, "session ID") },
            { label: "Copy Session Name", icon: "copy", onClick: () => copy(menu.session.title || menu.session.id, "session name") },
            { label: "Copy Project Path", icon: "copy", onClick: () => copy(menu.session.cwd, "project path") },
            { sep: true },
            { label: "Open Project Folder", icon: "fld", onClick: () => openProject(menu.session) },
            { label: "Open Project in VS Code", icon: "code", onClick: () => openVsCode(menu.session) },
            { sep: true },
            { label: "Export Session", icon: "save", onClick: () => window.open(aiStudioApi.exportUrl(menu.session.id), "_blank", "noopener,noreferrer") },
          ]}
        />
      ) : null}

      {pending ? <LaunchConfirmModal title={pending.title} launch={pending.launch} onCancel={cancelPending} onConfirm={confirmPending} /> : null}
    </div>
  );
}
