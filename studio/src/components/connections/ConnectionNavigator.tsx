import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../common/EmptyState";
import { SearchInput } from "../common/SearchInput";
import { Button } from "../common/Button";
import { ContextMenu, type TContextMenuState } from "../common/ContextMenu";
import { useStudioStore } from "../../state/studio-store";
import { studioApi } from "../../api/studio-api-client";
import type { TPublicDatabaseConnection } from "../../api/studio-api-types";
import { NewConnectionModal } from "./NewConnectionModal";
import { EditConnectionModal } from "./EditConnectionModal";

const ENV_ORDER = ["PROD", "QAS", "DEV", "SANDBOX", "CUSTOM", "OTHER"];
const ENV_COLORS: Record<string, string> = { DEV: "#22c55e", QAS: "#f59e0b", PROD: "#ef4444", SANDBOX: "#6366f1", CUSTOM: "#3b82f6" };

function connectionMatches(connection: TPublicDatabaseConnection, query: string): boolean {
  const haystack = `${connection.name} ${connection.type} ${connection.org ?? ""} ${connection.app ?? ""} ${connection.environment ?? ""}`.toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function ConnectionNavigator({
  search,
  onSearchChange,
  onImportFromBtp,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onImportFromBtp: () => void;
}): React.ReactElement {
  const { connections, connectionsLoading, activeConnectionId, connectionStatuses, setActiveConnectionId, loadConnections, toggleFavorite, removeConnection, toast } = useStudioStore();
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<(TContextMenuState & { connection: TPublicDatabaseConnection }) | null>(null);
  const [newConnOpen, setNewConnOpen] = useState(false);
  const [editConn, setEditConn] = useState<TPublicDatabaseConnection | null>(null);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const filtered = useMemo(() => connections.filter((connection) => connectionMatches(connection, search)), [connections, search]);

  const groups = useMemo(() => {
    const favorites = filtered.filter((connection) => connection.isFavorite);
    const byEnv: Record<string, TPublicDatabaseConnection[]> = {};
    for (const connection of filtered.filter((item) => !item.isFavorite)) {
      const env = connection.environment ?? "OTHER";
      (byEnv[env] ??= []).push(connection);
    }
    return { favorites, byEnv };
  }, [filtered]);

  const toggleGroup = (key: string): void => setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));

  const openMenu = (event: React.MouseEvent, connection: TPublicDatabaseConnection): void => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, connection, items: [] });
  };

  const renderRow = (connection: TPublicDatabaseConnection): React.ReactElement => {
    const color = connection.color || ENV_COLORS[connection.environment ?? ""] || "#64748b";
    const status = connectionStatuses[connection.id];
    return (
      <div
        key={connection.id}
        className={`conn-item${connection.id === activeConnectionId ? " active" : ""}`}
        onClick={() => setActiveConnectionId(connection.id)}
        onContextMenu={(event) => openMenu(event, connection)}
      >
        <div className={`ci-dot${activeConnectionId === connection.id ? " connected" : ""}`} style={{ background: color }} />
        <span className="ci-name" title={connection.name}>
          {connection.name}
        </span>
        {status && status !== "connected" ? <span className={`ci-state ${status}`}>{status}</span> : null}
        <span className="ci-type">{connection.type === "hana" ? "HANA" : "PG"}</span>
      </div>
    );
  };

  const renderGroup = (label: string, items: TPublicDatabaseConnection[], key: string): React.ReactElement | null => {
    if (!items.length) return null;
    const isCollapsed = Boolean(collapsedGroups[key]);
    return (
      <div className="conn-compact" key={key}>
        <div className={`conn-group-hdr${isCollapsed ? " collapsed" : ""}`} onClick={() => toggleGroup(key)}>
          <span>{label}</span>
          <span className="wiz-count">{items.length}</span>
          <span className="chevron">{isCollapsed ? "▸" : "▾"}</span>
        </div>
        {isCollapsed ? null : <div>{items.map(renderRow)}</div>}
      </div>
    );
  };

  return (
    <>
      <div className="side-actions">
        <Button size="sm" onClick={() => setNewConnOpen(true)}>
          + New
        </Button>
        <Button size="sm" variant="sec" onClick={onImportFromBtp}>
          Import BTP
        </Button>
      </div>
      <SearchInput value={search} onChange={onSearchChange} placeholder="Search connections..." />
      {connectionsLoading ? (
        <>
          <div className="skel" />
          <div className="skel" />
        </>
      ) : filtered.length ? (
        <div>
          {renderGroup("★ Favorites", groups.favorites, "favs")}
          {ENV_ORDER.map((env) => renderGroup(env, groups.byEnv[env] ?? [], env))}
        </div>
      ) : (
        <EmptyState>{connections.length ? "No results found" : "No connections yet. Click + New or Import."}</EmptyState>
      )}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: "Test connection", icon: "run", onClick: () => testConnection(contextMenu.connection) },
            { label: "Edit (name, color, env)", icon: "gear", onClick: () => setEditConn(contextMenu.connection) },
            { label: contextMenu.connection.isFavorite ? "Unfavorite" : "Favorite", icon: "star", onClick: () => toggleFavorite(contextMenu.connection.id, Boolean(contextMenu.connection.isFavorite)) },
            { label: "Reconnect", icon: "refresh", onClick: () => reconnect(contextMenu.connection) },
            {
              label: "Refresh credentials from BTP",
              icon: "imp",
              onClick: () => refreshFromBtp(contextMenu.connection),
            },
            { label: "Duplicate", icon: "plus", onClick: () => duplicate(contextMenu.connection) },
            { sep: true },
            { label: "Remove", icon: "trash", danger: true, onClick: () => removeWithConfirm(contextMenu.connection) },
          ]}
        />
      ) : null}

      {newConnOpen ? <NewConnectionModal onClose={() => setNewConnOpen(false)} onCreated={() => loadConnections()} /> : null}
      {editConn ? <EditConnectionModal connection={editConn} onClose={() => setEditConn(null)} onSaved={() => loadConnections()} /> : null}
    </>
  );

  async function testConnection(connection: TPublicDatabaseConnection): Promise<void> {
    toast(`Testing ${connection.name}...`);
    try {
      const result = await studioApi.testConnection(connection.id);
      toast(result.success ? `Connection OK (${result.serverVersion ?? ""}) ${result.durationMs}ms` : `Test failed: ${result.message}`, result.success ? "ok" : "err");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  }

  async function reconnect(connection: TPublicDatabaseConnection): Promise<void> {
    try {
      const result = await studioApi.reconnectConnection(connection.id);
      toast(result.success ? "Reconnected." : `Reconnect failed: ${result.message ?? ""}`, result.success ? "ok" : "err");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  }

  async function refreshFromBtp(connection: TPublicDatabaseConnection): Promise<void> {
    if (!connection.app || !connection.region || !connection.org || !connection.space) {
      toast("This connection was not imported from a BTP app (missing region/org/space/app).", "warn");
      return;
    }
    toast("Refreshing credentials from BTP app env...");
    try {
      const result = await studioApi.refreshCredentialsFromBtp(connection.id);
      if (result.ok) {
        toast(result.test?.success ? "Credentials refreshed and tested OK." : `Credentials refreshed (test: ${result.test?.message ?? "n/a"})`, result.test?.success ? "ok" : "warn");
        await loadConnections();
      } else {
        toast(`Refresh from BTP failed: ${result.error ?? ""}`, "err");
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  }

  async function duplicate(connection: TPublicDatabaseConnection): Promise<void> {
    await studioApi.duplicateConnection(connection.id);
    await loadConnections();
    toast("Duplicated.");
  }

  async function removeWithConfirm(connection: TPublicDatabaseConnection): Promise<void> {
    if (!window.confirm(`Remove connection '${connection.name}'?`)) return;
    await removeConnection(connection.id);
    toast("Removed.");
  }
}
