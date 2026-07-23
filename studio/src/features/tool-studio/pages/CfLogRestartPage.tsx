import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { BtpTargetSelector } from "../../../components/btp/BtpTargetSelector";
import { BtpAppSelector } from "../../../components/btp/BtpAppSelector";
import { CfLogViewer } from "../../../components/common/CfLogViewer";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCfTargetSummary } from "../../../api/studio-api-types";

type TStep = "target" | "app";

export function CfLogRestartPage(): React.ReactElement {
  const [step, setStep] = useState<TStep>("target");
  const [target, setTarget] = useState<TCfTargetSummary | undefined>();
  const [appName, setAppName] = useState<string | undefined>();

  const logsCall = useAsync((key: string, app: string) => toolStudioApi.getRecentLogs(key, [app]));
  const restartCall = useAsync((key: string, app: string) => toolStudioApi.restartApps(key, [app]));
  const [cloudLoggingUrl, setCloudLoggingUrl] = useState<string | undefined>();

  const targetLabel = target ? `${target.org} / ${target.space} (${target.region})` : "";

  // `cf logs --recent` only holds a short Loggregator buffer — if this app is bound to SAP Cloud
  // Logging (the same backing store as BTP Cockpit's "Logs and Traces"), offer a one-click link
  // into its dashboard for anything further back. Best-effort: silently absent if not bound.
  useEffect(() => {
    setCloudLoggingUrl(undefined);
    if (!target || !appName) return;
    let cancelled = false;
    toolStudioApi
      .getCloudLoggingDashboardLink(target.key, appName)
      .then((response) => {
        if (!cancelled) setCloudLoggingUrl(response.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [target, appName]);

  return (
    <div>
      <div className="ts-header">
        <h1>CF Log / Restart</h1>
        <p className="note">Tail recent logs or restart a BTP app in the selected org/space — runs under your own logged-in CF session, not a shared account.</p>
      </div>

      {step === "target" && (
        <div className="ts-card">
          <BtpTargetSelector
            onSelect={(selected) => {
              setTarget(selected);
              setAppName(undefined);
              setStep("app");
            }}
          />
        </div>
      )}

      {step === "app" && target && !appName && (
        <div className="ts-card">
          <BtpAppSelector
            targetKey={target.key}
            targetLabel={targetLabel}
            onSelect={(selectedApp) => setAppName(selectedApp)}
            onBack={() => setStep("target")}
          />
        </div>
      )}

      {step === "app" && target && appName && (
        <div className="ts-card">
          <div className="wiz-breadcrumb" style={{ marginBottom: 12 }}>
            <span className="crumb" onClick={() => setStep("target")}>Targets</span>
            <span className="sep"> › </span>
            <span className="crumb" onClick={() => setAppName(undefined)}>{targetLabel}</span>
            <span className="sep"> › </span>
            <span>{appName}</span>
          </div>

          <div className="row" style={{ marginBottom: 12 }}>
            <Button onClick={() => void logsCall.run(target.key, appName)} disabled={logsCall.loading}>
              {logsCall.loading ? <Spinner /> : "Get recent logs"}
            </Button>
            <Button variant="danger" onClick={() => void restartCall.run(target.key, appName)} disabled={restartCall.loading}>
              {restartCall.loading ? <Spinner /> : "Restart app"}
            </Button>
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
          {logsCall.data?.results?.[appName] && (
            logsCall.data.results[appName].ok ? (
              logsCall.data.results[appName].logs ? (
                <CfLogViewer logs={logsCall.data.results[appName].logs} title={`${appName} — recent logs`} />
              ) : (
                <div className="note faint">(no recent log lines)</div>
              )
            ) : (
              <div className="errbox">{logsCall.data.results[appName].error}</div>
            )
          )}

          {restartCall.error && <div className="errbox" style={{ marginTop: 12 }}>{restartCall.error}</div>}
          {restartCall.data?.results?.[appName] && (
            <div className={restartCall.data.results[appName].ok ? "note" : "errbox"} style={{ marginTop: 12 }}>
              {restartCall.data.results[appName].ok ? `Restart requested for ${appName}.` : restartCall.data.results[appName].error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
