import { useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { toolStudioApi } from "../api/tool-studio-api-client";

export function GitLabLoginModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (username: string) => void }): React.ReactElement {
  const [baseUrl, setBaseUrl] = useState("https://gitlab.simplemdg.com");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  const tokenUrl = `${baseUrl.trim().replace(/\/+$/, "")}/-/user_settings/personal_access_tokens?name=SimpleMDG%20Tool%20Studio&scopes=api,read_repository,write_repository`;

  const doLogin = async (): Promise<void> => {
    if (!baseUrl.trim() || !token.trim()) {
      setError("GitLab base URL and token are required.");
      return;
    }
    setError("");
    setLoggingIn(true);
    try {
      const result = await toolStudioApi.loginGitlab(baseUrl.trim(), token.trim());
      if (result.username || result.name) {
        onSuccess(result.username ?? result.name ?? "GitLab user");
      } else {
        setError(result.error ?? "Login failed.");
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : String(loginError));
    } finally {
      setLoggingIn(false);
    }
  };

  return (
    <Modal onClose={onClose} width={480}>
      <h3>Connect to GitLab</h3>
      <div className="note" style={{ marginBottom: 12 }}>
        Login enables group/project/branch discovery and merge-request creation. Your token is stored encrypted on this machine only.
      </div>

      <div className="field">
        <label>GitLab base URL</label>
        <input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
      </div>
      <div className="field">
        <label>Personal access token</label>
        <input
          className="input"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void doLogin();
            }
          }}
          autoFocus
        />
      </div>
      <div className="note" style={{ marginTop: 6 }}>
        Need a token? <a href={tokenUrl} target="_blank" rel="noreferrer">Create one here</a> (scopes: api, read_repository, write_repository).
      </div>

      {error ? <div className="errbox" style={{ marginTop: 8 }}>{error}</div> : null}

      <div className="row right" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void doLogin()} disabled={loggingIn}>
          {loggingIn ? "Logging in…" : "Login"}
        </Button>
      </div>
    </Modal>
  );
}
