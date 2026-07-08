import { useEffect, useState } from "react";
import { Icon } from "../common/Icon";
import { useStudioStore } from "../../state/studio-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { studioApi } from "../../api/studio-api-client";
import type { TSavedQuery } from "../../api/studio-api-types";

function WelcomeCard({ icon, title, description, onClick }: { icon: string; title: string; description: string; onClick: () => void }): React.ReactElement {
  return (
    <button className="wcard" onClick={onClick}>
      <div className="wc-ic">
        <Icon name={icon} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
    </button>
  );
}

export function WelcomePage({
  onImportFromBtp,
  onNewConnection,
  onOpenSqlConsole,
  onConnectToBtp,
}: {
  onImportFromBtp: () => void;
  onNewConnection: () => void;
  onOpenSqlConsole: () => void;
  onConnectToBtp: () => void;
}): React.ReactElement {
  const { cfStatus, cfOfflineMode, setCfOfflineMode, connections, activeConnectionId, setActiveConnectionId, refreshCfStatus, toast } = useStudioStore();
  const { openTab } = useWorkspaceStore();
  const [savedQueries, setSavedQueries] = useState<TSavedQuery[]>([]);

  useEffect(() => {
    studioApi
      .getSavedQueries()
      .then((response) => setSavedQueries(response.queries))
      .catch(() => undefined);
  }, []);

  const showCfBanner = !cfOfflineMode && cfStatus && !cfStatus.isLoggedIn && !cfStatus.hasCachedCredentials;
  const showConnected = cfStatus?.isLoggedIn && cfStatus.currentTarget;

  const disconnectCf = async (): Promise<void> => {
    if (!window.confirm("Disconnect from Cloud Foundry?")) return;
    try {
      await studioApi.logoutCf(false);
      await refreshCfStatus();
      toast("Disconnected from Cloud Foundry.");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  return (
    <div className="welcome">
      <h1>SimpleMDG CF DB Studio</h1>
      <div className="lede">A local HANA / PostgreSQL explorer with BTP credential import. Local only · 127.0.0.1</div>

      {showCfBanner ? (
        <div className="cf-login-banner">
          <div className="cf-lb-icon">☁</div>
          <div className="cf-lb-body">
            <div className="cf-lb-title">Cloud Foundry is not connected</div>
            <div className="cf-lb-sub">{cfStatus?.message || "Login to scan BTP regions, list apps, and import database credentials."}</div>
          </div>
          <div className="cf-lb-actions">
            <button className="btn" onClick={onConnectToBtp}>
              Connect to BTP
            </button>
            <button className="btn ghost" onClick={() => setCfOfflineMode(true)}>
              Use cached data only
            </button>
          </div>
        </div>
      ) : showConnected ? (
        <div className="note" style={{ marginBottom: 10, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <span>
            Connected{cfStatus?.cachedUsername ? ` as ${cfStatus.cachedUsername}` : ""}
            {cfStatus?.currentTarget?.region ? ` · ${cfStatus.currentTarget.region}` : ""}
          </span>
          <a className="link" onClick={disconnectCf} role="button" tabIndex={0}>
            Disconnect
          </a>
        </div>
      ) : null}

      <div className="wcards">
        <WelcomeCard icon="imp" title="Import from BTP App" description="Read cf env and detect HANA/PostgreSQL credentials." onClick={onImportFromBtp} />
        <WelcomeCard icon="plus" title="Add direct connection" description="Connect by host/port/user like DBeaver." onClick={onNewConnection} />
        <WelcomeCard
          icon="sql"
          title="Open SQL Console"
          description="Write and run SQL with safety checks."
          onClick={() => {
            if (!activeConnectionId) return;
            onOpenSqlConsole();
          }}
        />
        <WelcomeCard
          icon="db"
          title="Connect to cached DB"
          description="Pick a saved connection from the left."
          onClick={() => {
            if (connections[0]) setActiveConnectionId(connections[0].id);
          }}
        />
      </div>

      <div className="wcols">
        <div className="wcol">
          <h4>Recent connections</h4>
          <div className="wlist">
            {connections.slice(0, 5).map((connection) => (
              <div className="wli" key={connection.id} onClick={() => setActiveConnectionId(connection.id)}>
                <b>{connection.name}</b>
                <div className="note">
                  {connection.type === "hana" ? "HANA" : "PostgreSQL"} · {connection.org || connection.host}
                </div>
              </div>
            ))}
            {!connections.length ? <div className="empty">None yet.</div> : null}
          </div>
        </div>
        <div className="wcol">
          <h4>Recent queries</h4>
          <div className="wlist">
            {savedQueries.slice(0, 5).map((query) => (
              <div className="wli" key={query.id} onClick={() => openTab({ key: `sql:query:${query.id}`, kind: "sql", title: query.name, connectionId: query.connectionId, sql: query.sql, queryId: query.id })}>
                <b>{query.name}</b>
                <div className="note">
                  {query.connectionType ?? ""} · {new Date(query.updatedAt).toLocaleString()}
                </div>
              </div>
            ))}
            {!savedQueries.length ? <div className="empty">None yet.</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
