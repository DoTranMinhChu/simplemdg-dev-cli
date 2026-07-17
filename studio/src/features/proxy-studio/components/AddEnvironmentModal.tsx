import { useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { proxyStudioApi } from "../api/proxy-studio-api-client";

export function AddEnvironmentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }): React.ReactElement {
  const [repo, setRepo] = useState("");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [userID, setUserID] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = repo.trim() && name.trim() && url.trim() && userID.trim() && password.trim();

  const doSave = async (): Promise<void> => {
    if (!canSave) {
      setError("All fields are required.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const added = await proxyStudioApi.addEnvironment({ repo: repo.trim(), name: name.trim(), url: url.trim() });
      if (!added.envId) {
        setError(added.error ?? "Could not create the environment.");
        return;
      }

      const savedUser = await proxyStudioApi.saveUser({ envId: added.envId, userID: userID.trim(), password });
      if (!savedUser.saved) {
        setError(savedUser.error ?? "Environment created, but saving the user failed.");
        return;
      }

      onCreated();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={480}>
      <h3>Add Environment</h3>
      <div className="note" style={{ marginBottom: 12 }}>
        Saved locally to <code>~/.simplemdg/proxy/environments.json</code>.
      </div>

      <div className="field">
        <label>Repo / group label</label>
        <input className="input" placeholder="e.g. CYTIVA, DASHBOARD" value={repo} onChange={(event) => setRepo(event.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Environment label</label>
        <input className="input" placeholder="e.g. Prestage 4, QAS - uat" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label>Base URL</label>
        <input className="input" placeholder="https://...-simplemdg-web.cfapps...ondemand.com" value={url} onChange={(event) => setUrl(event.target.value)} />
      </div>
      <div className="field">
        <label>Login user (userID or email)</label>
        <input className="input" value={userID} onChange={(event) => setUserID(event.target.value)} />
      </div>
      <div className="field">
        <label>Password</label>
        <input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>

      {error ? <div className="errbox" style={{ marginTop: 8 }}>{error}</div> : null}

      <div className="row right" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void doSave()} disabled={saving || !canSave}>
          {saving ? "Saving…" : "Add environment"}
        </Button>
      </div>
    </Modal>
  );
}
