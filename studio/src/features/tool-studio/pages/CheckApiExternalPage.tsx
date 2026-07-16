import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { BtpTargetSelector } from "../../../components/btp/BtpTargetSelector";
import { BtpAppSelector } from "../../../components/btp/BtpAppSelector";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TBtpServiceCredential } from "../api/tool-studio-api-client";
import type { TCfTargetSummary } from "../../../api/studio-api-types";

type TStep = "credentials" | "target" | "app" | "candidates";

export function CheckApiExternalPage(): React.ReactElement {
  const [step, setStep] = useState<TStep>("credentials");
  const [target, setTarget] = useState<TCfTargetSummary | undefined>();
  const [appName, setAppName] = useState<string | undefined>();
  const [credential, setCredential] = useState<TBtpServiceCredential | undefined>();

  const savedCredentials = useAsync(() => toolStudioApi.listBtpCredentials());
  const candidatesCall = useAsync((key: string, app: string) => toolStudioApi.getXsuaaCandidates(key, app));
  const saveCall = useAsync((key: string, app: string, serviceName: string) => toolStudioApi.saveBtpCredential({ targetKey: key, appName: app, serviceName }));

  const [serviceKey, setServiceKey] = useState("");
  const [objectTypeShortName, setObjectTypeShortName] = useState("");
  const [path, setPath] = useState("/");
  const [filter, setFilter] = useState("");
  const callApi = useAsync(() =>
    toolStudioApi.callCheckApi({ credentialId: credential!.id, serviceKey, objectTypeShortName: objectTypeShortName || undefined, path, filter: filter || undefined }),
  );

  useEffect(() => {
    void savedCredentials.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (target && appName) void candidatesCall.run(target.key, appName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, appName]);

  const targetLabel = target ? `${target.org} / ${target.space} (${target.region})` : "";

  return (
    <div>
      <div className="ts-header">
        <h1>Check API External</h1>
        <p className="note">
          Test a customer's deployed CAP/OData service. The URL is derived from the CF route convention
          (<code>&lt;space&gt;-srv-&lt;service&gt;[-&lt;object-type&gt;].cfapps.&lt;region&gt;...</code>), the same way the legacy tool did it —
          nothing is hardcoded per customer.
        </p>
      </div>

      {step === "credentials" && (
        <div className="ts-card" style={{ maxWidth: 1050 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Button onClick={() => setStep("target")}>Import a new credential from BTP</Button>
          </div>
          {savedCredentials.loading ? (
            <EmptyState><Spinner /> loading saved credentials...</EmptyState>
          ) : !savedCredentials.data?.credentials.length ? (
            <EmptyState>No saved BTP service credentials yet — import one from a target/app above.</EmptyState>
          ) : (
            <div className="wiz-body">
              {savedCredentials.data.credentials.map((item) => (
                <div key={item.id} className="trow" onClick={() => { setCredential(item); setStep("candidates"); }}>
                  <div className="trow-main">
                    <div className="trow-title">{item.name}</div>
                    {/* Subaccount (CF org) shown explicitly — the same service name (e.g. "uaa") commonly
                        exists across many different customer subaccounts/regions. */}
                    <div className="trow-meta">{item.region} · {item.org} / {item.space} · {item.serviceName}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "target" && (
        <div className="ts-card" style={{ maxWidth: 900 }}>
          <BtpTargetSelector onSelect={(selected) => { setTarget(selected); setAppName(undefined); setStep("app"); }} />
        </div>
      )}

      {step === "app" && target && (
        <div className="ts-card" style={{ maxWidth: 900 }}>
          <BtpAppSelector targetKey={target.key} targetLabel={targetLabel} onSelect={(selected) => setAppName(selected)} onBack={() => setStep("target")} />
        </div>
      )}

      {step === "app" && target && appName && (
        <div className="ts-card" style={{ maxWidth: 900, marginTop: 12 }}>
          <div className="note" style={{ marginBottom: 8 }}>xsuaa-shaped services found in {appName}'s cf env:</div>
          {candidatesCall.loading ? (
            <EmptyState><Spinner /> loading services...</EmptyState>
          ) : candidatesCall.error || candidatesCall.data?.error ? (
            <div className="errbox">{candidatesCall.error || candidatesCall.data?.error}</div>
          ) : !candidatesCall.data?.candidates.length ? (
            <EmptyState>No xsuaa/uaa-shaped service found bound to this app.</EmptyState>
          ) : (
            <div className="wiz-body">
              {candidatesCall.data.candidates.map((candidate) => (
                <div key={candidate.serviceName} className="trow">
                  <div className="trow-main">
                    <div className="trow-title">{candidate.serviceName}</div>
                    <div className="trow-meta">{candidate.servicePlan ?? ""} · {candidate.url}</div>
                  </div>
                  <Button
                    size="sm"
                    disabled={saveCall.loading}
                    onClick={async () => {
                      const saved = await saveCall.run(target.key, appName, candidate.serviceName);
                      if (saved?.credential) {
                        setCredential(saved.credential);
                        setStep("candidates");
                      }
                    }}
                  >
                    Import
                  </Button>
                </div>
              ))}
            </div>
          )}
          {saveCall.error && <div className="errbox" style={{ marginTop: 8 }}>{saveCall.error}</div>}
        </div>
      )}

      {step === "candidates" && credential && (
        <div className="ts-card" style={{ maxWidth: 900 }}>
          <div className="wiz-breadcrumb" style={{ marginBottom: 12 }}>
            <span className="crumb" onClick={() => setStep("credentials")}>Credentials</span>
            <span className="sep"> › </span>
            <span>{credential.name}</span>
          </div>

          <div className="ts-grid-2">
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>Service key</label>
              <input className="input" placeholder="e.g. object-type, object-type-process" value={serviceKey} onChange={(event) => setServiceKey(event.target.value)} />
            </div>
            <div className="field">
              <label>Object type short name (optional)</label>
              <input className="input" placeholder="e.g. PRD" value={objectTypeShortName} onChange={(event) => setObjectTypeShortName(event.target.value)} />
            </div>
            <div className="field">
              <label>HTTP path</label>
              <input className="input" placeholder="/odata/v4/.../EntitySet" value={path} onChange={(event) => setPath(event.target.value)} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label>$filter (optional)</label>
              <input className="input" value={filter} onChange={(event) => setFilter(event.target.value)} />
            </div>
          </div>

          <div className="row">
            <Button onClick={() => void callApi.run()} disabled={callApi.loading || !serviceKey || !path}>
              {callApi.loading ? <Spinner /> : "Call"}
            </Button>
          </div>

          {callApi.error && <div className="errbox" style={{ marginTop: 12 }}>{callApi.error}</div>}
          {callApi.data && (
            <div style={{ marginTop: 12 }}>
              <div className="note">{callApi.data.url}</div>
              <div className={callApi.data.ok ? "note" : "errbox"} style={{ marginBottom: 8 }}>HTTP {callApi.data.status}</div>
              <pre className="cell-pre" style={{ maxHeight: 340, overflow: "auto" }}>{JSON.stringify(callApi.data.body, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
