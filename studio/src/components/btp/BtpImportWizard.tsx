import { useState } from "react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { BtpTargetSelector } from "./BtpTargetSelector";
import { BtpAppSelector } from "./BtpAppSelector";
import { BtpDatabaseServiceSelector } from "./BtpDatabaseServiceSelector";
import { CfLoginModal } from "./CfLoginModal";
import { studioApi } from "../../api/studio-api-client";
import { useStudioStore } from "../../state/studio-store";
import type { TCfTargetSummary, TDatabaseServiceCandidate } from "../../api/studio-api-types";

const SWATCHES = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#84cc16", "#64748b"];
const ENVIRONMENTS = ["", "DEV", "QAS", "PROD", "SANDBOX", "CUSTOM"];

type TStep = "target" | "app" | "database" | "save";
const STEP_LABELS: Array<[TStep, string]> = [
  ["target", "Target"],
  ["app", "App"],
  ["database", "Database"],
  ["save", "Save"],
];

function SaveStep({
  org,
  appName,
  candidate,
  onBack,
  onSave,
  saving,
  error,
}: {
  org: string;
  appName: string;
  candidate: TDatabaseServiceCandidate;
  onBack: () => void;
  onSave: (name: string, environment: string, color: string, favorite: boolean) => void;
  saving: boolean;
  error: string;
}): React.ReactElement {
  // Prefixed with the org (global account) — app/service names repeat across different customers'
  // BTP accounts (e.g. every tenant has its own "simplemdg-srv-process-system"), so without this
  // prefix the connection list becomes a wall of identical-looking entries once you've imported
  // more than one account.
  const [name, setName] = useState(`${org} / ${appName} / ${candidate.serviceName}`);
  const [environment, setEnvironment] = useState("");
  const [color, setColor] = useState("");
  const [favorite, setFavorite] = useState(false);

  return (
    <div>
      <div className="kvs">
        <div className="k">Service</div>
        <div>{candidate.serviceName}</div>
        <div className="k">Type</div>
        <div>{candidate.type === "hana" ? "SAP HANA" : "PostgreSQL"}</div>
        <div className="k">Host</div>
        <div>{candidate.host}</div>
      </div>
      <div className="field">
        <label>Display name</label>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label>Environment</label>
        <select className="select" value={environment} onChange={(event) => setEnvironment(event.target.value)}>
          {ENVIRONMENTS.map((env) => (
            <option key={env} value={env}>
              {env || "(none)"}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Color</label>
        <div className="swatches">
          {SWATCHES.map((swatch) => (
            <div key={swatch} className={`swatch${color === swatch ? " sel" : ""}`} style={{ background: swatch }} onClick={() => setColor(swatch)} />
          ))}
        </div>
      </div>
      <label className="note" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />
        <span>Mark as favorite</span>
      </label>
      {error ? (
        <div className="errbox" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
      <div className="row right" style={{ marginTop: 12 }}>
        <Button variant="ghost" onClick={onBack} disabled={saving}>
          ◁ Back
        </Button>
        <Button onClick={() => onSave(name.trim(), environment, color, favorite)} disabled={saving}>
          {saving ? "Importing & testing…" : "Save & activate"}
        </Button>
      </div>
    </div>
  );
}

export function BtpImportWizard({ onClose, onImported }: { onClose: () => void; onImported: (connectionId: string) => void }): React.ReactElement {
  const { cfStatus, cfOfflineMode, setCfOfflineMode, toast, setActiveConnectionId, loadConnections } = useStudioStore();
  const gated = !cfOfflineMode && cfStatus != null && !cfStatus.isLoggedIn && !cfStatus.hasCachedCredentials;

  const [showLogin, setShowLogin] = useState(false);
  const [step, setStep] = useState<TStep>("target");
  const [target, setTarget] = useState<TCfTargetSummary | null>(null);
  const [appName, setAppName] = useState("");
  const [candidate, setCandidate] = useState<TDatabaseServiceCandidate | null>(null);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  if (gated && !showLogin) {
    return (
      <Modal onClose={onClose} width={480}>
        <h3>Import from BTP App</h3>
        <div className="cf-login-banner" style={{ margin: "0 0 14px" }}>
          <div className="cf-lb-icon">☁</div>
          <div className="cf-lb-body">
            <div className="cf-lb-title">Cloud Foundry is not connected</div>
            <div className="cf-lb-sub">Login to scan BTP targets and import database credentials.</div>
          </div>
        </div>
        <div className="row right">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={() => setCfOfflineMode(true)}>
            Use cached data only
          </Button>
          <Button onClick={() => setShowLogin(true)}>Connect now</Button>
        </div>
      </Modal>
    );
  }

  if (showLogin) {
    return <CfLoginModal onClose={() => setShowLogin(false)} onSuccess={() => setShowLogin(false)} />;
  }

  const finalizeImport = async (name: string, environment: string, color: string, favorite: boolean): Promise<void> => {
    if (!candidate) return;
    setSaving(true);
    setSaveError("");
    try {
      const imported = await studioApi.importFromApp({ app: appName, serviceName: candidate.serviceName, type: candidate.type, targetKey: target?.key });
      const id = imported.connection.id;
      await studioApi.updateConnection(id, { name, environment, color, isFavorite: favorite });
      const test = await studioApi.testConnection(id);
      await loadConnections();
      setActiveConnectionId(id);
      toast(test.success ? `Imported & connected: ${name}` : `Imported (test failed: ${test.message})`, test.success ? "ok" : "warn");
      onImported(id);
      onClose();
    } catch (importError) {
      setSaveError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setSaving(false);
    }
  };

  const activeIndex = STEP_LABELS.findIndex(([key]) => key === step);

  return (
    <Modal onClose={onClose} width={620}>
      <h3>Import from BTP App</h3>
      <div className="steps" style={{ marginBottom: 12 }}>
        {STEP_LABELS.map(([key, label], index) => (
          <div key={key} className={`step${index === activeIndex ? " active" : index < activeIndex ? " done" : ""}`}>
            {label}
          </div>
        ))}
      </div>

      <div style={{ minHeight: 320 }}>
        {step === "target" ? (
          <BtpTargetSelector
            onSelect={(selected) => {
              setTarget(selected);
              studioApi.addBtpRecent(selected.key).catch(() => undefined);
              setStep("app");
            }}
          />
        ) : step === "app" && target ? (
          <BtpAppSelector
            targetKey={target.key}
            targetLabel={`${target.org}${target.space ? ` / ${target.space}` : ""} (${target.region})`}
            onSelect={(selectedApp) => {
              setAppName(selectedApp);
              setStep("database");
            }}
            onBack={() => setStep("target")}
          />
        ) : step === "database" && target ? (
          <BtpDatabaseServiceSelector
            targetKey={target.key}
            appName={appName}
            targetLabel={`${target.org}${target.space ? ` / ${target.space}` : ""} (${target.region})`}
            onSelect={(selected) => {
              setCandidate(selected);
              setStep("save");
            }}
            onBack={() => setStep("app")}
          />
        ) : step === "save" && candidate && target ? (
          <SaveStep org={target.org} appName={appName} candidate={candidate} onBack={() => setStep("database")} onSave={finalizeImport} saving={saving} error={saveError} />
        ) : null}
      </div>
    </Modal>
  );
}
