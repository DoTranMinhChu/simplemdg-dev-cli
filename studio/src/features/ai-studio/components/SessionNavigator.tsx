import { useMemo, useState } from "react";
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
import type { TAiSession } from "../../../api/ai-studio-api-types";

type TDisplayRow = { kind: "session"; session: TAiSession; nested: boolean } | { kind: "loading"; parentId: string };

export function SessionNavigator(): React.ReactElement {
  const {
    sessions,
    sessionsLoading,
    sessionsError,
    nextCursor,
    filter,
    setFilter,
    loadMoreSessions,
    reloadSessions,
    selectedSessionId,
    selectSession,
    refreshing,
    refreshAll,
    toast,
    patchSession,
  } = useAiStudioStore();
  const { pending, requestLaunch, confirmPending, cancelPending } = useSessionResume(toast);
  const [menu, setMenu] = useState<(TContextMenuState & { session: TAiSession }) | undefined>();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [childrenByParent, setChildrenByParent] = useState<Map<string, TAiSession[]>>(new Map());
  const [loadingParents, setLoadingParents] = useState<Set<string>>(new Set());

  const toggleExpand = async (session: TAiSession): Promise<void> => {
    const isExpanded = expandedIds.has(session.id);
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (isExpanded) next.delete(session.id);
      else next.add(session.id);
      return next;
    });
    if (isExpanded || childrenByParent.has(session.id)) return;
    setLoadingParents((prev) => new Set(prev).add(session.id));
    try {
      const result = await aiStudioApi.getChildSessions(session.id);
      setChildrenByParent((prev) => new Map(prev).set(session.id, result.sessions));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setLoadingParents((prev) => {
        const next = new Set(prev);
        next.delete(session.id);
        return next;
      });
    }
  };

  // Sub-agent sessions never appear as their own top-level row (see AiSessionStore.listSessions) —
  // expanding a parent splices its children in directly beneath it here, so the flat list the user
  // scrolls through always reflects "main sessions, with sub-agents nested", never siblings.
  const displayRows = useMemo<TDisplayRow[]>(() => {
    const rows: TDisplayRow[] = [];
    for (const session of sessions) {
      rows.push({ kind: "session", session, nested: false });
      if (expandedIds.has(session.id)) {
        if (loadingParents.has(session.id)) {
          rows.push({ kind: "loading", parentId: session.id });
        } else {
          for (const child of childrenByParent.get(session.id) ?? []) rows.push({ kind: "session", session: child, nested: true });
        }
      }
    }
    return rows;
  }, [sessions, expandedIds, childrenByParent, loadingParents]);

  const { containerRef, firstRowRef, window: virtualWindow } = useVirtualList(displayRows.length);

  const copy = (text: string, label: string): void => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}: ${text.length > 60 ? `${text.slice(0, 60)}…` : text}`);
  };

  const togglePinned = (session: TAiSession): void => {
    const next = !session.pinned;
    patchSession(session.id, { pinned: next });
    aiStudioApi.setPinned(session.id, next);
  };

  const renameSession = async (session: TAiSession): Promise<void> => {
    const name = window.prompt("Rename session (leave blank to reset to the auto-detected name)", session.title);
    if (name === null) return;
    try {
      await aiStudioApi.renameSession(session.id, name);
      patchSession(session.id, { title: name.trim() || session.title });
      // Auto-derived titles can change once cleared (e.g. re-ingestion), so a full reload beats a
      // stale patch — but only bother refetching for the "reset" path, since a real rename already
      // has the exact right value in hand from the input above.
      if (!name.trim()) reloadSessions();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
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
          <ProjectPicker value={filter.cwd} onChange={(cwd) => setFilter({ cwd, project: undefined })} />
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
          {displayRows.slice(virtualWindow.startIndex, virtualWindow.endIndex).map((row, sliceIndex) => {
            const rowRef = virtualWindow.startIndex === 0 && sliceIndex === 0 ? firstRowRef : undefined;
            if (row.kind === "loading") {
              return (
                <div key={`loading:${row.parentId}`} ref={rowRef} className="tnote" style={{ paddingLeft: 34 }}>
                  <span className="spin" /> loading sub-agents...
                </div>
              );
            }
            const { session, nested } = row;
            return (
              <SessionRow
                key={session.id}
                ref={rowRef}
                session={session}
                nested={nested}
                expanded={expandedIds.has(session.id)}
                onToggleExpand={session.subAgentCount > 0 && !nested ? () => toggleExpand(session) : undefined}
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
              />
            );
          })}
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
            { label: "Rename Session", onClick: () => renameSession(menu.session) },
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
