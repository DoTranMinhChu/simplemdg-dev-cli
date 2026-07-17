import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { proxyStudioApi, type TProxyEnvironmentSummary } from "../api/proxy-studio-api-client";
import { UserDialog, type TUserDialogMode } from "./UserDialog";
import { EditEnvironmentModal } from "./EditEnvironmentModal";

const STATUS_LABELS: Record<string, string> = {
  starting: "STARTING",
  authenticating: "AUTHENTICATING",
  "browser-auth": "BROWSER AUTH...",
  ready: "READY",
  stopped: "STOPPED",
};

function deriveStatus(env: TProxyEnvironmentSummary): string {
  if (env.status?.status) return env.status.status;
  return env.running ? "ready" : "stopped";
}

/** One environment: status badge, per-port toggle buttons + a custom port, inline user
 * management, edit/delete — ported from the reference dashboard's `buildCard`. */
export function EnvironmentCard({
  env,
  active,
  onSelect,
  onChanged,
}: {
  env: TProxyEnvironmentSummary;
  active: boolean;
  onSelect: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const users = env.userList.map((user) => user.userID);
  const passwordlessUserIds = env.knownUserIds.filter((userID) => !users.includes(userID));
  const [selectedUser, setSelectedUser] = useState(users[0] ?? "");
  const [customPort, setCustomPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [userDialog, setUserDialog] = useState<{ mode: TUserDialogMode; userID: string } | undefined>();
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (users.length > 0 && !users.includes(selectedUser)) {
      setSelectedUser(users[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env.userList]);

  const status = deriveStatus(env);
  const isReady = status === "ready";

  const startOnPorts = async (ports?: number[]): Promise<void> => {
    setError("");
    setBusy(true);
    try {
      const result = await proxyStudioApi.startEnvironment(env.id, { userID: selectedUser || undefined, ports });
      if (result.error) setError(result.error);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const openLogin = async (): Promise<void> => {
    setError("");
    setBusy(true);
    try {
      const result = await proxyStudioApi.openLogin(env.id, selectedUser || undefined);
      if (result.error) setError(result.error);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setBusy(false);
    }
  };

  const stopOnPort = async (port?: number): Promise<void> => {
    setBusy(true);
    try {
      await proxyStudioApi.stopEnvironment(env.id, port);
    } finally {
      setBusy(false);
      onChanged();
    }
  };

  const togglePort = (port: number): void => {
    if (env.runningPorts.includes(port)) {
      void stopOnPort(port);
    } else {
      void startOnPorts([port]);
    }
  };

  const runCustomPort = (): void => {
    const port = Number(customPort);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      setError("Enter a valid port between 1 and 65535.");
      return;
    }
    if (env.runningPorts.includes(port)) {
      setError(`Port ${port} is already running for this environment.`);
      return;
    }
    setCustomPort("");
    void startOnPorts([port]);
  };

  const extraRunningPorts = env.runningPorts.filter((port) => !env.ports.includes(port));

  const remove = async (): Promise<void> => {
    if (!window.confirm(`Remove ${env.displayName}?`)) return;
    await proxyStudioApi.deleteEnvironment(env.id);
    onChanged();
  };

  return (
    <article
      className={`ts-card proxy-env-card${active ? " active" : ""}${isReady ? " is-ready" : ""}`}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,select,input")) return;
        onSelect();
      }}
    >
      {editing && <EditEnvironmentModal env={env} onClose={() => setEditing(false)} onSaved={onChanged} />}
      {userDialog && (
        <UserDialog
          envId={env.id}
          envLabel={env.displayName}
          mode={userDialog.mode}
          initialUserID={userDialog.userID}
          onClose={() => setUserDialog(undefined)}
          onDone={onChanged}
        />
      )}

      <div className="proxy-env-head">
        <div className="proxy-env-head-main">
          <div className="proxy-env-title" title={env.displayName}>{env.displayName}</div>
          <div className="proxy-env-url" title={env.url}>{env.url}</div>
        </div>
        <div className="row" style={{ flexShrink: 0 }}>
          <Button variant="ghost" size="sm" title="Update environment" onClick={() => setEditing(true)}>
            ✏️
          </Button>
          <Button variant="ghost" size="sm" title="Delete environment" onClick={() => void remove()}>
            🗑
          </Button>
        </div>
      </div>

      <span className={`status-badge ${status}`}>{STATUS_LABELS[status] ?? status.toUpperCase()}</span>
      {env.status?.message ? <div className="note">{env.status.message}</div> : null}

      <div className="proxy-user-row">
        <select className="select" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} disabled={users.length === 0} title={selectedUser}>
          {users.length === 0 ? (
            <option value="">(no users)</option>
          ) : (
            users.map((userId) => (
              <option key={userId} value={userId}>
                {userId}
              </option>
            ))
          )}
        </select>
        <div className="proxy-user-actions">
          <Button variant="ghost" size="sm" title="Add user" onClick={() => setUserDialog({ mode: "add", userID: "" })}>
            ➕
          </Button>
          <Button variant="ghost" size="sm" title="Edit selected user's credentials" disabled={!selectedUser} onClick={() => setUserDialog({ mode: "update", userID: selectedUser })}>
            🔑
          </Button>
          <Button variant="ghost" size="sm" title="Delete selected user" disabled={!selectedUser} onClick={() => setUserDialog({ mode: "delete", userID: selectedUser })}>
            🗑
          </Button>
        </div>
        <Button
          size="sm"
          variant="sec"
          title={selectedUser ? `Open a browser window logged in as ${selectedUser}` : "Select a user first"}
          disabled={busy || !selectedUser}
          onClick={() => void openLogin()}
        >
          🔓 Login
        </Button>
      </div>

      {users.length === 0 ? <div className="note">No users yet — add one before starting.</div> : null}
      {passwordlessUserIds.length > 0 ? (
        <div className="note">
          Also expects: {passwordlessUserIds.join(", ")} — {passwordlessUserIds.length === 1 ? "add a password" : "add passwords"} (➕) to use{" "}
          {passwordlessUserIds.length === 1 ? "it" : "them"}.
        </div>
      ) : null}
      {error ? <div className="errbox">{error}</div> : null}

      <div className="proxy-port-row">
        {env.ports.map((port) => (
          <button
            key={port}
            type="button"
            className={`port-toggle-btn${env.runningPorts.includes(port) ? " running" : ""}`}
            disabled={busy || users.length === 0}
            onClick={() => togglePort(port)}
            title={env.runningPorts.includes(port) ? `Stop port ${port}` : `Start on port ${port}`}
          >
            {env.runningPorts.includes(port) ? `⏹ ${port}` : port}
          </button>
        ))}
      </div>

      <div className="proxy-custom-port-row">
        <input
          className="input"
          type="number"
          placeholder="Port"
          title="Run on a custom port"
          value={customPort}
          onChange={(event) => setCustomPort(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runCustomPort();
          }}
        />
        <Button size="sm" variant="sec" disabled={busy || users.length === 0} onClick={runCustomPort}>
          ▶ Run
        </Button>
      </div>

      {extraRunningPorts.length > 0 && (
        <div className="proxy-port-row">
          {extraRunningPorts.map((port) => (
            <span key={port} className="port-chip">
              :{port}
              <button type="button" className="port-chip-stop" title={`Stop port ${port}`} onClick={() => void stopOnPort(port)}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
