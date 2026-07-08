import { useEffect, useState } from "react";
import { Modal } from "../common/Modal";
import { Button } from "../common/Button";
import { studioApi } from "../../api/studio-api-client";
import { useStudioStore } from "../../state/studio-store";
import type { TCfLoginResponse, TCfRegionEndpoint } from "../../api/studio-api-types";

export function CfLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (result: TCfLoginResponse) => void }): React.ReactElement {
  const { toast, refreshCfStatus, setCfOfflineMode, cfStatus } = useStudioStore();
  const [tab, setTab] = useState<"password" | "sso">("password");
  const [regions, setRegions] = useState<TCfRegionEndpoint[]>([]);
  const [regionsLoading, setRegionsLoading] = useState(true);
  const [apiEndpoint, setApiEndpoint] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [ssoError, setSsoError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [checkingSso, setCheckingSso] = useState(false);

  useEffect(() => {
    studioApi
      .getCfRegions()
      .then((response) => {
        setRegions(response.regions);
        if (cfStatus?.currentTarget?.apiEndpoint) setApiEndpoint(cfStatus.currentTarget.apiEndpoint);
        else if (response.regions[0]) setApiEndpoint(response.regions[0].apiEndpoint);
      })
      .catch(() => undefined)
      .finally(() => setRegionsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doLogin = async (): Promise<void> => {
    const endpoint = apiEndpoint === "__custom__" ? customEndpoint.trim() : apiEndpoint;
    if (!endpoint) return setError("Select or enter a CF API endpoint.");
    if (!email.trim() || !password) return setError("Email and password are required.");
    setError("");
    setLoggingIn(true);
    try {
      const result = await studioApi.loginCf({ apiEndpoint: endpoint, username: email.trim(), password, remember });
      if (result.success) {
        setCfOfflineMode(false);
        await refreshCfStatus();
        toast(`Connected to Cloud Foundry as ${result.username} (${result.region}). Refreshing BTP targets…`);
        onSuccess(result);
      } else {
        setError(result.error ?? "Login failed.");
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setLoggingIn(false);
    }
  };

  const checkSso = async (): Promise<void> => {
    setCheckingSso(true);
    setSsoError("");
    try {
      const status = await studioApi.getCfAuthStatus();
      if (status.isLoggedIn) {
        await refreshCfStatus();
        toast("Cloud Foundry session detected. Refreshing BTP targets…");
        studioApi.refreshBtpTargets().catch(() => undefined);
        onSuccess({ success: true, username: status.cachedUsername, apiEndpoint: status.currentTarget?.apiEndpoint, region: status.currentTarget?.region });
      } else {
        setSsoError("No active CF session found. Complete the SSO login in your terminal first.");
      }
    } catch (statusError) {
      setSsoError(statusError instanceof Error ? statusError.message : String(statusError));
    } finally {
      setCheckingSso(false);
    }
  };

  return (
    <Modal onClose={onClose} width={520}>
      <h3>Connect to BTP / Cloud Foundry</h3>
      <div className="note" style={{ marginBottom: 12 }}>
        Login to enable BTP target scanning, app listing, and database credential import.
      </div>

      <div className="cf-login-tabs">
        <div className={`cf-login-tab${tab === "password" ? " active" : ""}`} onClick={() => setTab("password")}>
          Email / Password
        </div>
        <div className={`cf-login-tab${tab === "sso" ? " active" : ""}`} onClick={() => setTab("sso")}>
          SSO
        </div>
      </div>

      {tab === "password" ? (
        regionsLoading ? (
          <div className="note">Loading regions...</div>
        ) : (
          <>
            <div className="field">
              <label>CF API endpoint / region</label>
              <select className="select" value={apiEndpoint} onChange={(event) => setApiEndpoint(event.target.value)}>
                {regions.map((region) => (
                  <option key={region.apiEndpoint} value={region.apiEndpoint}>
                    {region.label || region.region} – {region.apiEndpoint}
                  </option>
                ))}
                <option value="__custom__">Custom endpoint…</option>
              </select>
            </div>
            {apiEndpoint === "__custom__" ? (
              <div className="field">
                <label>Custom CF API endpoint</label>
                <input className="input" placeholder="https://api.cf.xx10.hana.ondemand.com" value={customEndpoint} onChange={(event) => setCustomEndpoint(event.target.value)} />
              </div>
            ) : null}
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" placeholder="your.email@company.com" value={email} onChange={(event) => setEmail(event.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    doLogin();
                  }
                }}
              />
            </div>
            <label className="note" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>Remember credentials securely (encrypted)</span>
            </label>
            {error ? (
              <div className="errbox" style={{ marginTop: 8 }}>
                {error}
              </div>
            ) : null}
            <div className="row right" style={{ marginTop: 14 }}>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={doLogin} disabled={loggingIn}>
                {loggingIn ? "Logging in…" : "Login"}
              </Button>
            </div>
          </>
        )
      ) : (
        <>
          <div
            className="note"
            style={{ marginTop: 10 }}
            dangerouslySetInnerHTML={{
              __html:
                "Run this command in your terminal to login with SSO, then click <b>I have completed SSO login</b> below.<br><br><code>smdg cf login --sso</code><br><br>or<br><br><code>cf login --sso</code>",
            }}
          />
          {ssoError ? (
            <div className="errbox" style={{ marginTop: 8 }}>
              {ssoError}
            </div>
          ) : null}
          <div className="row right" style={{ marginTop: 14 }}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="sec" onClick={checkSso} disabled={checkingSso}>
              {checkingSso ? "Checking…" : "I have completed SSO login"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
