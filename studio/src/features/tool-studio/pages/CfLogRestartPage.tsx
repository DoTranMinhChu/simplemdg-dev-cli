import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { Modal } from "../../../components/common/Modal";
import { BtpTargetSelector } from "../../../components/btp/BtpTargetSelector";
import { CfLogViewer } from "../../../components/common/CfLogViewer";
import { CfMultiAppPicker } from "../components/CfMultiAppPicker";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCfAppOpResult } from "../api/tool-studio-api-client";
import { parseCfLogs } from "../../../lib/cf-log-parser";
import type { TCfLogLevel } from "../../../lib/cf-log-parser";
import type { TCfTargetSummary } from "../../../api/studio-api-types";

type TStep = "target" | "apps" | "logs";

const LEVEL_ORDER: TCfLogLevel[] = ["error", "warn", "info", "debug", "unknown"];
const LEVEL_LABEL: Record<TCfLogLevel, string> = { error: "Error", warn: "Warn", info: "Info", debug: "Debug", unknown: "Other" };

export function CfLogRestartPage(): React.ReactElement {
  const [step, setStep] = useState<TStep>("target");
  const [target, setTarget] = useState<TCfTargetSummary | undefined>();
  const [appNames, setAppNames] = useState<string[]>([]);
  const [activeApp, setActiveApp] = useState<string | undefined>();
  const [bulkLevel, setBulkLevel] = useState<TCfLogLevel | "all">("all");
  const [timeFrom, setTimeFrom] = useState("");
  const [timeTo, setTimeTo] = useState("");
  const [showAddApps, setShowAddApps] = useState(false);

  const logsCall = useAsync((key: string, apps: string[]) => toolStudioApi.getRecentLogs(key, apps));
  const restartCall = useAsync((key: string, apps: string[]) => toolStudioApi.restartApps(key, apps));
  const sshCall = useAsync((key: string, app: string) => toolStudioApi.openSshTerminal(key, app));
  const [cloudLoggingUrl, setCloudLoggingUrl] = useState<string | undefined>();

  // Per-app log results, seeded from each `logsCall` run (which fetches every tab at once) and
  // patched in place by `refreshApp` (which re-fetches just the active tab) — kept as its own state
  // rather than reading straight off `logsCall.data` so a single-app refresh doesn't clobber the
  // other tabs' already-fetched logs.
  const [results, setResults] = useState<Record<string, TCfAppOpResult>>({});
  const [refreshingApp, setRefreshingApp] = useState<string | undefined>();

  useEffect(() => {
    if (logsCall.data?.results) setResults(logsCall.data.results);
  }, [logsCall.data]);

  const refreshApp = async (appName: string): Promise<void> => {
    if (!target) return;
    setRefreshingApp(appName);
    try {
      const response = await toolStudioApi.getRecentLogs(target.key, [appName]);
      if (response.results) setResults((prev) => ({ ...prev, ...response.results }));
    } finally {
      setRefreshingApp(undefined);
    }
  };

  const targetLabel = target ? `${target.org} / ${target.space} (${target.region})` : "";

  // `cf logs --recent` only holds a short Loggregator buffer — if the active tab's app is bound to
  // SAP Cloud Logging (the same backing store as BTP Cockpit's "Logs and Traces"), offer a
  // one-click link into its dashboard for anything further back. Best-effort: silently absent if
  // not bound.
  useEffect(() => {
    setCloudLoggingUrl(undefined);
    if (!target || !activeApp) return;
    let cancelled = false;
    toolStudioApi
      .getCloudLoggingDashboardLink(target.key, activeApp)
      .then((response) => {
        if (!cancelled) setCloudLoggingUrl(response.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [target, activeApp]);

  // Per-tab error count (for the tab bar's badge — the fastest way to spot which of several
  // services actually has a problem without opening each one) and totals across every fetched app
  // (shown next to the bulk Log Type chips) — computed together so the logs only get parsed once.
  const { errorCounts, aggregateCounts, totalLines } = useMemo(() => {
    const errorCounts: Record<string, number> = {};
    const aggregateCounts: Record<TCfLogLevel, number> = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 };
    let totalLines = 0;
    for (const [app, result] of Object.entries(results)) {
      if (result.ok && result.logs) {
        const lines = parseCfLogs(result.logs);
        errorCounts[app] = lines.filter((line) => line.level === "error").length;
        for (const line of lines) aggregateCounts[line.level] += 1;
        totalLines += lines.length;
      } else {
        errorCounts[app] = 0;
      }
    }
    return { errorCounts, aggregateCounts, totalLines };
  }, [results]);

  const timeFromMs = timeFrom ? new Date(timeFrom).getTime() : undefined;
  const timeToMs = timeTo ? new Date(timeTo).getTime() : undefined;

  const runGetLogs = (apps: string[], preferredActiveApp?: string): void => {
    if (!target) return;
    setAppNames(apps);
    setActiveApp(preferredActiveApp && apps.includes(preferredActiveApp) ? preferredActiveApp : apps[0]);
    void logsCall.run(target.key, apps);
  };

  const activeResult = activeApp ? results[activeApp] : undefined;

  return (
    <div>
      <div className="ts-header">
        <h1>CF Log / Restart</h1>
        <p className="note">Tail recent logs (across several apps at once, tabbed) or restart a BTP app — runs under your own logged-in CF session, not a shared account.</p>
      </div>

      {step === "target" && (
        <div className="ts-card">
          <BtpTargetSelector
            onSelect={(selected) => {
              setTarget(selected);
              setAppNames([]);
              setActiveApp(undefined);
              setResults({});
              logsCall.reset();
              setStep("apps");
            }}
          />
        </div>
      )}

      {step === "apps" && target && (
        <div className="ts-card">
          <CfMultiAppPicker
            targetKey={target.key}
            targetLabel={targetLabel}
            onBack={() => setStep("target")}
            onConfirm={(apps) => {
              runGetLogs(apps);
              setStep("logs");
            }}
          />
        </div>
      )}

      {step === "logs" && target && appNames.length > 0 && (
        <div className="ts-card">
          <div className="wiz-breadcrumb" style={{ marginBottom: 12 }}>
            <span className="crumb" onClick={() => setStep("target")}>Targets</span>
            <span className="sep"> › </span>
            <span className="crumb" onClick={() => setStep("apps")}>{targetLabel}</span>
            <span className="sep"> › </span>
            <span>{appNames.length} app{appNames.length === 1 ? "" : "s"}</span>
          </div>

          <div className="row" style={{ marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <Button onClick={() => void logsCall.run(target.key, appNames)} disabled={logsCall.loading}>
              {logsCall.loading ? <Spinner /> : "⟳ Refresh all"}
            </Button>
            <Button variant="sec" onClick={() => setShowAddApps(true)}>
              + Add apps
            </Button>
            {activeApp && (
              <Button variant="danger" onClick={() => void restartCall.run(target.key, [activeApp])} disabled={restartCall.loading}>
                {restartCall.loading ? <Spinner /> : `Restart ${activeApp}`}
              </Button>
            )}
            {activeApp && (
              <Button
                variant="sec"
                onClick={() => void sshCall.run(target.key, activeApp)}
                disabled={sshCall.loading}
                title="Opens a new local terminal window already connected via cf ssh"
              >
                {sshCall.loading ? <Spinner /> : `🖥 SSH into ${activeApp}`}
              </Button>
            )}
            {activeApp && (
              <Button variant="sec" onClick={() => void refreshApp(activeApp)} disabled={refreshingApp === activeApp}>
                {refreshingApp === activeApp ? <Spinner /> : `⟳ Refresh ${activeApp}`}
              </Button>
            )}
            {cloudLoggingUrl && (
              <a
                className="btn sec"
                style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
                href={cloudLoggingUrl}
                target="_blank"
                rel="noreferrer"
                title="Opens SAP Cloud Logging's dashboard (BTP SSO login required) for log history beyond cf logs --recent's short buffer"
              >
                ↗ Open in SAP Cloud Logging
              </a>
            )}
          </div>

          {logsCall.error && <div className="errbox" style={{ marginBottom: 12 }}>{logsCall.error}</div>}
          {restartCall.error && <div className="errbox" style={{ marginBottom: 12 }}>{restartCall.error}</div>}
          {activeApp && restartCall.data?.results?.[activeApp] && (
            <div className={restartCall.data.results[activeApp].ok ? "note" : "errbox"} style={{ marginBottom: 12 }}>
              {restartCall.data.results[activeApp].ok ? `Restart requested for ${activeApp}.` : restartCall.data.results[activeApp].error}
            </div>
          )}
          {sshCall.data && (
            <div className={sshCall.data.ok ? "note" : "errbox"} style={{ marginBottom: 12 }}>
              {sshCall.data.ok ? `Opened a new terminal — connecting via cf ssh ${activeApp}.` : sshCall.data.error}
            </div>
          )}
          {sshCall.error && <div className="errbox" style={{ marginBottom: 12 }}>{sshCall.error}</div>}

          {logsCall.loading && !logsCall.data ? (
            <div className="note faint" style={{ padding: 16 }}>
              <Spinner /> fetching logs for {appNames.length} app{appNames.length === 1 ? "" : "s"}...
            </div>
          ) : logsCall.data?.results ? (
            <>
              <div className="cflog-tabs">
                {appNames.map((app) => (
                  <button key={app} type="button" className={`cflog-tab${app === activeApp ? " active" : ""}`} onClick={() => setActiveApp(app)}>
                    {app}
                    <span className={`cflog-tab-badge${errorCounts[app] ? " error" : ""}`}>{errorCounts[app] ?? 0}</span>
                  </button>
                ))}
              </div>

              <div className="cflog-bulk-toolbar">
                <span className="note" style={{ flexShrink: 0 }}>Filter all tabs:</span>
                <div className="cflog-level-chips">
                  <button type="button" className={`cflog-chip${bulkLevel === "all" ? " active" : ""}`} onClick={() => setBulkLevel("all")}>
                    All ({totalLines})
                  </button>
                  {LEVEL_ORDER.filter((lvl) => aggregateCounts[lvl] > 0).map((lvl) => (
                    <button key={lvl} type="button" className={`cflog-chip level-${lvl}${bulkLevel === lvl ? " active" : ""}`} onClick={() => setBulkLevel(lvl)}>
                      {LEVEL_LABEL[lvl]} ({aggregateCounts[lvl]})
                    </button>
                  ))}
                </div>
                <span className="note" style={{ flexShrink: 0, marginLeft: 8 }}>Time range:</span>
                <input type="datetime-local" className="input" style={{ width: 200 }} value={timeFrom} onChange={(event) => setTimeFrom(event.target.value)} />
                <span className="note">to</span>
                <input type="datetime-local" className="input" style={{ width: 200 }} value={timeTo} onChange={(event) => setTimeTo(event.target.value)} />
                {(timeFrom || timeTo) && (
                  <Button variant="ghost" size="sm" onClick={() => { setTimeFrom(""); setTimeTo(""); }}>
                    Clear
                  </Button>
                )}
              </div>

              {activeApp && refreshingApp === activeApp ? (
                <div className="note faint" style={{ padding: 16 }}>
                  <Spinner /> refreshing {activeApp}...
                </div>
              ) : (
                activeApp &&
                activeResult &&
                (activeResult.ok ? (
                  activeResult.logs ? (
                    <CfLogViewer key={`${activeApp}-${bulkLevel}`} logs={activeResult.logs} title={`${activeApp} — recent logs`} initialLevel={bulkLevel} timeFrom={timeFromMs} timeTo={timeToMs} />
                  ) : (
                    <div className="note faint">(no recent log lines)</div>
                  )
                ) : (
                  <div className="errbox">{activeResult.error}</div>
                ))
              )}
            </>
          ) : null}

          {showAddApps && (
            <Modal onClose={() => setShowAddApps(false)} width={620}>
              <h3 style={{ marginTop: 0 }}>Add apps</h3>
              <CfMultiAppPicker
                targetKey={target.key}
                targetLabel={targetLabel}
                initialSelected={appNames}
                showTargetsCrumb={false}
                backLabel="Cancel"
                confirmLabel="Update"
                onBack={() => setShowAddApps(false)}
                onConfirm={(apps) => {
                  runGetLogs(apps, activeApp);
                  setShowAddApps(false);
                }}
              />
            </Modal>
          )}
        </div>
      )}
    </div>
  );
}
