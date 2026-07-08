import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useLocalWorkspace } from "../hooks/useLocalWorkspace";
import { studioApi } from "../api/studio-api-client";
import type { TGridSortState, TStudioTabType, TStudioWorkspaceState } from "../api/studio-api-types";

export type TWorkspaceTab = {
  id: string;
  key: string;
  kind: TStudioTabType;
  title: string;
  pinned?: boolean;
  dirty?: boolean;
  closable?: boolean;
  connectionId?: string;
  schema?: string;
  objectName?: string;
  objectType?: "table" | "view";
  sql?: string;
  queryId?: string;
  filter?: string;
  pageSize?: number;
  pageIndex?: number;
  sort?: TGridSortState[];
  openedAt: string;
};

type TOpenTabSpec = Omit<TWorkspaceTab, "id" | "openedAt" | "dirty"> & { id?: string };

type TWorkspaceStoreValue = {
  tabs: TWorkspaceTab[];
  activeTabId: string;
  activeTab: TWorkspaceTab | undefined;
  restored: boolean;
  layout: { sidebarWidth: number; sidebarCollapsed: boolean; readOnly: boolean };

  openTab: (spec: TOpenTabSpec) => string;
  closeTab: (id: string) => void;
  closeOtherTabs: (id: string) => void;
  closeTabsToRight: (id: string) => void;
  duplicateTab: (id: string) => void;
  switchTab: (id: string) => void;
  setTabDirty: (id: string, dirty: boolean) => void;
  updateTab: (id: string, patch: Partial<TWorkspaceTab>) => void;
  togglePinned: (id: string) => void;
  setSidebarWidth: (px: number) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setReadOnly: (value: boolean) => void;
};

const WorkspaceStoreContext = createContext<TWorkspaceStoreValue | undefined>(undefined);

const WELCOME_TAB: TWorkspaceTab = {
  id: "welcome",
  key: "welcome",
  kind: "welcome",
  title: "Welcome",
  closable: false,
  openedAt: new Date().toISOString(),
};

let seq = 0;

export function WorkspaceStoreProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [tabs, setTabs] = useState<TWorkspaceTab[]>([WELCOME_TAB]);
  const [activeTabId, setActiveTabId] = useState("welcome");
  const [restored, setRestored] = useState(false);
  const [sidebarWidth, setSidebarWidthState] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsedState] = useState(false);
  const [readOnly, setReadOnlyState] = useState(false);
  const { scheduleSave, loadWorkspace } = useLocalWorkspace();
  const hasRestoredRef = useRef(false);

  const persist = useCallback(
    (nextTabs: TWorkspaceTab[], nextActiveTabId: string, nextSidebarWidth: number, nextSidebarCollapsed: boolean, nextReadOnly: boolean) => {
      const persistable = nextTabs.filter((tab) => tab.kind !== "welcome");
      const workspace: TStudioWorkspaceState = {
        version: 1,
        activeTabId: nextActiveTabId,
        tabGroups: [],
        layout: { sidebarWidth: nextSidebarWidth, sidebarCollapsed: nextSidebarCollapsed, readOnly: nextReadOnly },
        updatedAt: new Date().toISOString(),
        tabs: persistable.map((tab) => ({
          id: tab.id,
          type: tab.kind,
          title: tab.title,
          pinned: tab.pinned,
          dirty: tab.dirty,
          connectionId: tab.connectionId,
          schema: tab.schema,
          objectName: tab.objectName,
          objectType: tab.objectType,
          sql: tab.sql,
          filter: tab.filter,
          pageSize: tab.pageSize,
          pageIndex: tab.pageIndex,
          sort: tab.sort,
          openedAt: tab.openedAt,
          updatedAt: new Date().toISOString(),
        })),
      };
      scheduleSave(workspace);
    },
    [scheduleSave],
  );

  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    Promise.all([loadWorkspace(), studioApi.getSettings().catch(() => null)])
      .then(([workspace, settingsResponse]) => {
        const settings = settingsResponse?.settings;

        if (workspace?.layout) {
          if (workspace.layout.sidebarWidth) setSidebarWidthState(workspace.layout.sidebarWidth);
          if (workspace.layout.sidebarCollapsed) setSidebarCollapsedState(true);
          if (workspace.layout.readOnly) setReadOnlyState(true);
        } else if (settings?.readOnlyByDefault) {
          setReadOnlyState(true);
        }

        const restoreWorkspace = settings ? settings.restoreWorkspace !== false : true;
        if (workspace?.tabs?.length && restoreWorkspace) {
          const restoredTabs: TWorkspaceTab[] = workspace.tabs.map((tab) => ({
            id: tab.id,
            key: `${tab.type}:${tab.connectionId ?? ""}:${tab.schema ?? ""}.${tab.objectName ?? ""}:${tab.id}`,
            kind: tab.type,
            title: tab.title,
            pinned: tab.pinned,
            dirty: false,
            closable: true,
            connectionId: tab.connectionId,
            schema: tab.schema,
            objectName: tab.objectName,
            objectType: tab.objectType,
            sql: tab.sql,
            filter: tab.filter,
            pageSize: tab.pageSize,
            pageIndex: tab.pageIndex,
            sort: tab.sort,
            openedAt: tab.openedAt,
          }));
          setTabs([WELCOME_TAB, ...restoredTabs]);
          if (workspace.activeTabId && restoredTabs.some((tab) => tab.id === workspace.activeTabId)) {
            setActiveTabId(workspace.activeTabId);
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setRestored(true));
  }, [loadWorkspace]);

  const openTab = useCallback(
    (spec: TOpenTabSpec): string => {
      let resultId = "";
      setTabs((prev) => {
        const existing = prev.find((tab) => tab.key === spec.key);
        if (existing) {
          resultId = existing.id;
          return prev;
        }
        const id = spec.id ?? `wt${++seq}`;
        resultId = id;
        const next: TWorkspaceTab = { ...spec, id, dirty: false, openedAt: new Date().toISOString(), closable: spec.closable ?? true };
        const nextTabs = [...prev, next];
        persist(nextTabs, id, sidebarWidth, sidebarCollapsed, readOnly);
        return nextTabs;
      });
      setActiveTabId((prevActive) => resultId || prevActive);
      return resultId;
    },
    [persist, sidebarWidth, sidebarCollapsed, readOnly],
  );

  const switchTab = useCallback(
    (id: string) => {
      setActiveTabId(id);
      persist(tabs, id, sidebarWidth, sidebarCollapsed, readOnly);
    },
    [tabs, persist, sidebarWidth, sidebarCollapsed, readOnly],
  );

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((tab) => tab.id === id);
        const nextTabs = prev.filter((tab) => tab.id !== id);
        if (activeTabId === id) {
          const next = nextTabs[Math.max(0, index - 1)] ?? WELCOME_TAB;
          setActiveTabId(next.id);
          persist(nextTabs, next.id, sidebarWidth, sidebarCollapsed, readOnly);
        } else {
          persist(nextTabs, activeTabId, sidebarWidth, sidebarCollapsed, readOnly);
        }
        return nextTabs;
      });
    },
    [activeTabId, persist, sidebarWidth, sidebarCollapsed, readOnly],
  );

  const closeOtherTabs = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((tab) => tab.id === id || tab.closable === false);
        persist(next, id, sidebarWidth, sidebarCollapsed, readOnly);
        return next;
      });
      setActiveTabId(id);
    },
    [persist, sidebarWidth, sidebarCollapsed, readOnly],
  );

  const closeTabsToRight = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const index = prev.findIndex((tab) => tab.id === id);
        if (index < 0) return prev;
        const next = prev.filter((tab, i) => i <= index || tab.closable === false);
        if (!next.some((tab) => tab.id === activeTabId)) {
          setActiveTabId(id);
          persist(next, id, sidebarWidth, sidebarCollapsed, readOnly);
        } else {
          persist(next, activeTabId, sidebarWidth, sidebarCollapsed, readOnly);
        }
        return next;
      });
    },
    [activeTabId, persist, sidebarWidth, sidebarCollapsed, readOnly],
  );

  const duplicateTab = useCallback(
    (id: string) => {
      let newId = "";
      setTabs((prev) => {
        const source = prev.find((tab) => tab.id === id);
        if (!source) return prev;
        newId = `wt${++seq}`;
        const clone: TWorkspaceTab = { ...source, id: newId, key: `${source.key}:copy:${newId}`, pinned: false, dirty: false, openedAt: new Date().toISOString() };
        const next = [...prev, clone];
        persist(next, newId, sidebarWidth, sidebarCollapsed, readOnly);
        return next;
      });
      if (newId) setActiveTabId(newId);
    },
    [persist, sidebarWidth, sidebarCollapsed, readOnly],
  );

  const setTabDirty = useCallback((id: string, dirty: boolean) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, dirty } : tab)));
  }, []);

  const updateTab = useCallback((id: string, patch: Partial<TWorkspaceTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }, []);

  const togglePinned = useCallback((id: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)));
  }, []);

  const setSidebarWidth = useCallback(
    (px: number) => {
      setSidebarWidthState(px);
      persist(tabs, activeTabId, px, sidebarCollapsed, readOnly);
    },
    [tabs, activeTabId, sidebarCollapsed, readOnly, persist],
  );

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => {
      setSidebarCollapsedState(collapsed);
      persist(tabs, activeTabId, sidebarWidth, collapsed, readOnly);
    },
    [tabs, activeTabId, sidebarWidth, readOnly, persist],
  );

  const setReadOnly = useCallback(
    (value: boolean) => {
      setReadOnlyState(value);
      persist(tabs, activeTabId, sidebarWidth, sidebarCollapsed, value);
    },
    [tabs, activeTabId, sidebarWidth, sidebarCollapsed, persist],
  );

  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  const value: TWorkspaceStoreValue = {
    tabs,
    activeTabId,
    activeTab,
    restored,
    layout: { sidebarWidth, sidebarCollapsed, readOnly },
    openTab,
    closeTab,
    closeOtherTabs,
    closeTabsToRight,
    duplicateTab,
    switchTab,
    setTabDirty,
    updateTab,
    togglePinned,
    setSidebarWidth,
    setSidebarCollapsed,
    setReadOnly,
  };

  return <WorkspaceStoreContext.Provider value={value}>{children}</WorkspaceStoreContext.Provider>;
}

export function useWorkspaceStore(): TWorkspaceStoreValue {
  const context = useContext(WorkspaceStoreContext);
  if (!context) throw new Error("useWorkspaceStore must be used inside WorkspaceStoreProvider");
  return context;
}
