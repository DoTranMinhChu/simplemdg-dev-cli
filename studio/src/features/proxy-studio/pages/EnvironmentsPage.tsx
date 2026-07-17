import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { useAsync } from "../../../hooks/useAsync";
import { proxyStudioApi, type TProxyEnvironmentSummary } from "../api/proxy-studio-api-client";
import { useProxyEvents } from "../hooks/useProxyEvents";
import { AddEnvironmentModal } from "../components/AddEnvironmentModal";
import { EnvironmentCard } from "../components/EnvironmentCard";
import { LogsConsole } from "../components/LogsConsole";
import { PortsPanel } from "../components/PortsPanel";
import { ImportEnvironmentsModal } from "../components/ImportEnvironmentsModal";

/** Triggers a same-origin file download without navigating away from the SPA. */
function downloadUrl(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function primeNotificationPermission(): void {
  if (!("Notification" in window) || Notification.permission !== "default") return;
  Notification.requestPermission().catch(() => undefined);
}

function notifyReady(env: TProxyEnvironmentSummary): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification("SimpleMDG Proxy Studio", { body: `${env.displayName} is READY.`, tag: `proxy-ready-${env.id}` });
  } catch {
    // ignore notification failures
  }
}

function deriveStatus(env: TProxyEnvironmentSummary): string {
  return env.status?.status ?? (env.running ? "ready" : "stopped");
}

const PAGE_SIZE_OPTIONS = [6, 8, 12, 24];
const DEFAULT_PAGE_SIZE = 8;

export function EnvironmentsPage(): React.ReactElement {
  const list = useAsync(() => proxyStudioApi.listEnvironments());
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [activeEnvId, setActiveEnvId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [repoFilter, setRepoFilter] = useState("");
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "running" | "stopped">("");
  const [portFilter, setPortFilter] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const previousStatusRef = useRef(new Map<string, string>());

  useEffect(() => {
    void list.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useProxyEvents((event) => {
    if (event.channel === "status") void list.run();
  });

  const environments = list.data?.environments ?? [];

  // Desktop notification the moment any environment transitions into READY.
  useEffect(() => {
    for (const env of environments) {
      const status = deriveStatus(env);
      const prior = previousStatusRef.current.get(env.id);
      if (status === "ready" && prior !== "ready") {
        notifyReady(env);
      }
      previousStatusRef.current.set(env.id, status);
    }
  }, [environments]);

  // Also recovers when the active environment's id changes out from under it (editing repo/name
  // changes the derived id) or the active environment was deleted — not just on first load.
  useEffect(() => {
    if (environments.length === 0) return;
    const stillExists = environments.some((env) => env.id === activeEnvId);
    if (!activeEnvId || !stillExists) {
      setActiveEnvId(environments[0].id);
    }
  }, [environments, activeEnvId]);

  const repoOptions = useMemo(() => {
    return Array.from(new Set(environments.map((env) => env.repo).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [environments]);

  const nameOptions = useMemo(() => {
    const relevant = repoFilter ? environments.filter((env) => env.repo === repoFilter) : environments;
    return Array.from(new Set(relevant.map((env) => env.name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }, [environments, repoFilter]);

  const portOptions = useMemo(() => {
    const ports = new Set<number>();
    for (const env of environments) {
      for (const port of env.runningPorts) ports.add(port);
    }
    return Array.from(ports).sort((a, b) => a - b);
  }, [environments]);

  const visibleEnvironments = useMemo(() => {
    const query = search.trim().toLowerCase();
    return environments.filter((env) => {
      if (repoFilter && env.repo !== repoFilter) return false;
      if (nameFilter && env.name !== nameFilter) return false;
      if (statusFilter === "running" && !env.running) return false;
      if (statusFilter === "stopped" && env.running) return false;
      if (portFilter && !env.runningPorts.includes(Number(portFilter))) return false;
      if (!query) return true;
      return `${env.repo} ${env.name}`.toLowerCase().includes(query);
    });
  }, [environments, search, repoFilter, nameFilter, statusFilter, portFilter]);

  // Reset to page 1 whenever the filtered set (or page size) changes shape, so a stale page
  // number never strands the user on an empty page.
  useEffect(() => {
    setPage(1);
  }, [search, repoFilter, nameFilter, statusFilter, portFilter, pageSize]);

  const pageCount = Math.max(1, Math.ceil(visibleEnvironments.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedEnvironments = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return visibleEnvironments.slice(start, start + pageSize);
  }, [visibleEnvironments, currentPage, pageSize]);

  const activeEnv = environments.find((env) => env.id === activeEnvId);

  return (
    <div>
      {showAdd && <AddEnvironmentModal onClose={() => setShowAdd(false)} onCreated={() => void list.run()} />}
      {showImport && <ImportEnvironmentsModal onClose={() => setShowImport(false)} onImported={() => void list.run()} />}

      <div className="ts-header">
        <h1>Environments</h1>
      </div>

      <PortsPanel />

      <div className="proxy-filter-row">
        <input className="input" placeholder="Search by repo or name..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <select
          className="select"
          value={repoFilter}
          onChange={(event) => {
            setRepoFilter(event.target.value);
            setNameFilter("");
          }}
        >
          <option value="">All Repos</option>
          {repoOptions.map((repo) => (
            <option key={repo} value={repo}>
              {repo}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={nameFilter}
          onChange={(event) => {
            const value = event.target.value;
            setNameFilter(value);
            if (value) {
              const matched = environments.find((env) => env.name === value);
              if (matched) setRepoFilter(matched.repo);
            }
          }}
        >
          <option value="">All Names</option>
          {nameOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select className="select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "" | "running" | "stopped")}>
          <option value="">Any Status</option>
          <option value="running">Running</option>
          <option value="stopped">Stopped</option>
        </select>
        <select className="select" value={portFilter} onChange={(event) => setPortFilter(event.target.value)} disabled={portOptions.length === 0}>
          <option value="">All Ports</option>
          {portOptions.map((port) => (
            <option key={port} value={port}>
              :{port}
            </option>
          ))}
        </select>
      </div>

      <div className="proxy-actions-row">
        <Button
          onClick={() => {
            primeNotificationPermission();
            setShowAdd(true);
          }}
        >
          + Add Environment
        </Button>
        <Button variant="ghost" onClick={() => void list.run()} disabled={list.loading}>
          {list.loading ? <Spinner /> : "Refresh"}
        </Button>
        <Button
          variant="sec"
          title="Downloads a full backup of your environments, including your saved passwords."
          onClick={() => downloadUrl(proxyStudioApi.exportUrl())}
        >
          ⬇ Export
        </Button>
        <Button variant="sec" onClick={() => setShowImport(true)}>
          ⬆ Import
        </Button>
        <label className="proxy-page-size">
          Per page
          <select className="select" value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="proxy-env-meta">
        Showing {visibleEnvironments.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
        {"–"}
        {Math.min(currentPage * pageSize, visibleEnvironments.length)} of {visibleEnvironments.length}
        {visibleEnvironments.length !== environments.length ? ` (filtered from ${environments.length})` : ""}
      </div>

      {list.error ? <div className="errbox" style={{ marginBottom: 12 }}>{list.error}</div> : null}

      {visibleEnvironments.length === 0 ? (
        <div className="ts-card">
          <p className="note">
            {environments.length === 0 ? 'No environments yet. Click "Add Environment" to create one.' : "No environments match your filters."}
          </p>
        </div>
      ) : (
        <>
          <div className="proxy-env-grid">
            {pagedEnvironments.map((env) => (
              <EnvironmentCard key={env.id} env={env} active={activeEnvId === env.id} onSelect={() => setActiveEnvId(env.id)} onChanged={() => void list.run()} />
            ))}
          </div>

          {pageCount > 1 ? (
            <div className="proxy-pagination">
              <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                ← Prev
              </Button>
              <span className="proxy-pagination-label">
                Page {currentPage} of {pageCount}
              </span>
              <Button variant="ghost" size="sm" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                Next →
              </Button>
            </div>
          ) : null}
        </>
      )}

      <LogsConsole ownerId={activeEnvId} ownerLabel={activeEnv?.displayName ?? ""} />
    </div>
  );
}
