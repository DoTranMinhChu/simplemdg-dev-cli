import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { studioApi } from "../api/studio-api-client";
import type { TCfAuthStatus, TConnectionStatus, TPublicDatabaseConnection } from "../api/studio-api-types";

export type TToastKind = "ok" | "err" | "warn";
export type TToast = { id: string; message: string; kind: TToastKind };
export type TStatusBarStats = { connectionLabel: string; connectionKind: "ok" | "err" | "run" | ""; duration: string; rows: string; pendingCount: number };

const DEFAULT_STATUS_BAR: TStatusBarStats = { connectionLabel: "Ready", connectionKind: "ok", duration: "-", rows: "-", pendingCount: 0 };

type TStudioStoreValue = {
  connections: TPublicDatabaseConnection[];
  connectionsLoading: boolean;
  activeConnectionId: string;
  activeConnection: TPublicDatabaseConnection | undefined;
  activeSchema: string;
  setActiveSchema: (schema: string) => void;
  connectionStatuses: Record<string, TConnectionStatus>;
  cfStatus: TCfAuthStatus | null;
  cfOfflineMode: boolean;
  toasts: TToast[];
  statusBar: TStatusBarStats;

  loadConnections: () => Promise<void>;
  setActiveConnectionId: (id: string) => void;
  setConnectionStatus: (id: string, status: TConnectionStatus) => void;
  toggleFavorite: (id: string, current: boolean) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
  refreshCfStatus: () => Promise<void>;
  setCfOfflineMode: (value: boolean) => void;
  toast: (message: string, kind?: TToastKind) => void;
  dismissToast: (id: string) => void;
  setStatusBar: (patch: Partial<TStatusBarStats>) => void;
};

const StudioStoreContext = createContext<TStudioStoreValue | undefined>(undefined);

export function StudioStoreProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [connections, setConnections] = useState<TPublicDatabaseConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [activeConnectionId, setActiveConnectionId] = useState("");
  const [activeSchema, setActiveSchema] = useState("");
  const [connectionStatuses, setConnectionStatuses] = useState<Record<string, TConnectionStatus>>({});
  const [cfStatus, setCfStatus] = useState<TCfAuthStatus | null>(null);
  const [cfOfflineMode, setCfOfflineMode] = useState(false);
  const [toasts, setToasts] = useState<TToast[]>([]);

  const toast = useCallback((message: string, kind: TToastKind = "ok") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, message, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((item) => item.id !== id)), kind === "err" ? 5200 : 3200);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const loadConnections = useCallback(async () => {
    setConnectionsLoading(true);
    try {
      const response = await studioApi.getConnections();
      setConnections(response.connections);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setConnectionsLoading(false);
    }
  }, [toast]);

  const setConnectionStatus = useCallback((id: string, status: TConnectionStatus) => {
    setConnectionStatuses((prev) => ({ ...prev, [id]: status }));
  }, []);

  const toggleFavorite = useCallback(
    async (id: string, current: boolean) => {
      await studioApi.updateConnection(id, { isFavorite: !current });
      await loadConnections();
    },
    [loadConnections],
  );

  const removeConnection = useCallback(
    async (id: string) => {
      await studioApi.removeConnection(id);
      if (activeConnectionId === id) setActiveConnectionId("");
      await loadConnections();
    },
    [activeConnectionId, loadConnections],
  );

  const refreshCfStatus = useCallback(async () => {
    try {
      const status = await studioApi.getCfAuthStatus();
      setCfStatus(status);
    } catch {
      setCfStatus(null);
    }
  }, []);

  const activeConnection = useMemo(() => connections.find((connection) => connection.id === activeConnectionId), [connections, activeConnectionId]);

  const [statusBar, setStatusBarState] = useState<TStatusBarStats>(DEFAULT_STATUS_BAR);
  const setStatusBar = useCallback((patch: Partial<TStatusBarStats>) => {
    setStatusBarState((prev) => ({ ...prev, ...patch }));
  }, []);

  const value: TStudioStoreValue = {
    connections,
    connectionsLoading,
    activeConnectionId,
    activeConnection,
    activeSchema,
    setActiveSchema,
    connectionStatuses,
    cfStatus,
    cfOfflineMode,
    toasts,
    statusBar,
    loadConnections,
    setActiveConnectionId,
    setConnectionStatus,
    toggleFavorite,
    removeConnection,
    refreshCfStatus,
    setCfOfflineMode,
    toast,
    dismissToast,
    setStatusBar,
  };

  return <StudioStoreContext.Provider value={value}>{children}</StudioStoreContext.Provider>;
}

export function useStudioStore(): TStudioStoreValue {
  const context = useContext(StudioStoreContext);
  if (!context) throw new Error("useStudioStore must be used inside StudioStoreProvider");
  return context;
}
