import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { aiStudioApi, type TSessionFilter } from "../../../api/ai-studio-api-client";
import type { TAiOverview, TAiSession } from "../../../api/ai-studio-api-types";

export type TToastKind = "ok" | "err" | "warn";
export type TToast = { id: string; message: string; kind: TToastKind };

export type TAiWorkspaceTabKind = "overview" | "conversation" | "execution" | "timeline" | "graph" | "files" | "commands" | "errors" | "verification" | "raw";
export type TAiWorkspaceTab = { sessionId: string; kind: TAiWorkspaceTabKind };

export type TAiPage = "overview" | "sessions" | "projects" | "doctor" | "plugins";

type TAiStudioStoreValue = {
  sessions: TAiSession[];
  sessionsLoading: boolean;
  sessionsError: string | undefined;
  nextCursor: string | undefined;
  filter: TSessionFilter;
  setFilter: (patch: Partial<TSessionFilter>) => void;
  loadMoreSessions: () => Promise<void>;
  reloadSessions: () => Promise<void>;

  overview: TAiOverview | undefined;
  reloadOverview: () => Promise<void>;

  selectedSessionId: string | undefined;
  selectSession: (sessionId: string | undefined) => void;
  activeTabKind: TAiWorkspaceTabKind;
  setActiveTabKind: (kind: TAiWorkspaceTabKind) => void;

  currentPage: TAiPage;
  setCurrentPage: (page: TAiPage) => void;

  /** Patches a session's fields in the in-memory list (e.g. after toggling pin/favorite) without a full reload. */
  patchSession: (sessionId: string, patch: Partial<TAiSession>) => void;

  refreshing: boolean;
  refreshAll: () => Promise<void>;

  toasts: TToast[];
  toast: (message: string, kind?: TToastKind) => void;
  dismissToast: (id: string) => void;
};

const AiStudioStoreContext = createContext<TAiStudioStoreValue | undefined>(undefined);

export function AiStudioStoreProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [sessions, setSessions] = useState<TAiSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [filter, setFilterState] = useState<TSessionFilter>({});
  const [overview, setOverview] = useState<TAiOverview | undefined>();
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>();
  const [activeTabKind, setActiveTabKind] = useState<TAiWorkspaceTabKind>("conversation");
  const [currentPage, setCurrentPage] = useState<TAiPage>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [toasts, setToasts] = useState<TToast[]>([]);

  const toast = useCallback((message: string, kind: TToastKind = "ok") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), kind === "err" ? 5200 : 3200);
  }, []);

  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((item) => item.id !== id)), []);

  const reloadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(undefined);
    try {
      const response = await aiStudioApi.listSessions(filter, undefined, 50);
      setSessions(response.sessions);
      setNextCursor(response.nextCursor);
    } catch (error) {
      setSessionsError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const loadMoreSessions = useCallback(async () => {
    if (!nextCursor) return;
    setSessionsLoading(true);
    try {
      const response = await aiStudioApi.listSessions(filter, nextCursor, 50);
      setSessions((prev) => [...prev, ...response.sessions]);
      setNextCursor(response.nextCursor);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setSessionsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, nextCursor]);

  const reloadOverview = useCallback(async () => {
    try {
      setOverview(await aiStudioApi.getOverview());
    } catch {
      // Non-fatal: the session list still works without the summary tiles.
    }
  }, []);

  useEffect(() => {
    reloadSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    reloadOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setFilter = useCallback((patch: Partial<TSessionFilter>) => setFilterState((prev) => ({ ...prev, ...patch })), []);

  const selectSession = useCallback((sessionId: string | undefined) => {
    setSelectedSessionId(sessionId);
    setActiveTabKind("conversation");
    if (sessionId) setCurrentPage("sessions");
  }, []);

  const patchSession = useCallback((sessionId: string, patch: Partial<TAiSession>) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? { ...session, ...patch } : session)));
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await aiStudioApi.refresh();
      toast(result.filesIngested > 0 ? `Ingested ${result.filesIngested} new session file(s).` : "No new sessions found.");
      await Promise.all([reloadSessions(), reloadOverview()]);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setRefreshing(false);
    }
  }, [reloadSessions, reloadOverview, toast]);

  const value = useMemo<TAiStudioStoreValue>(
    () => ({
      sessions,
      sessionsLoading,
      sessionsError,
      nextCursor,
      filter,
      setFilter,
      loadMoreSessions,
      reloadSessions,
      overview,
      reloadOverview,
      selectedSessionId,
      selectSession,
      activeTabKind,
      setActiveTabKind,
      currentPage,
      setCurrentPage,
      patchSession,
      refreshing,
      refreshAll,
      toasts,
      toast,
      dismissToast,
    }),
    [
      sessions,
      sessionsLoading,
      sessionsError,
      nextCursor,
      filter,
      setFilter,
      loadMoreSessions,
      reloadSessions,
      overview,
      reloadOverview,
      selectedSessionId,
      selectSession,
      activeTabKind,
      currentPage,
      patchSession,
      refreshing,
      refreshAll,
      toasts,
      toast,
      dismissToast,
    ],
  );

  return <AiStudioStoreContext.Provider value={value}>{children}</AiStudioStoreContext.Provider>;
}

export function useAiStudioStore(): TAiStudioStoreValue {
  const context = useContext(AiStudioStoreContext);
  if (!context) throw new Error("useAiStudioStore must be used inside AiStudioStoreProvider");
  return context;
}
