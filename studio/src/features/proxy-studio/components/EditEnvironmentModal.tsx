import { useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { proxyStudioApi, type TProxyEnvironmentSummary } from "../api/proxy-studio-api-client";

export function EditEnvironmentModal({
  env,
  onClose,
  onSaved,
}: {
  env: TProxyEnvironmentSummary;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const [repo, setRepo] = useState(env.repo);
  const [name, setName] = useState(env.name);
  const [url, setUrl] = useState(env.url);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = repo.trim() && name.trim() && url.trim();

  const doSave = async (): Promise<void> => {
    if (!canSave) {
      setError("All fields are required.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const result = await proxyStudioApi.updateEnvironment({ envId: env.id, repo: repo.trim(), name: name.trim(), url: url.trim() });
      if (!result.envId) {
        setError(result.error ?? "Could not update the environment.");
        return;
      }
      onSaved();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={480}>
      <h3>Update Environment</h3>
      <div className="note" style={{ marginBottom: 12 }}>{env.displayName}</div>

      <div className="field">
        <label>Repo / group label</label>
        <input className="input" value={repo} onChange={(event) => setRepo(event.target.value)} autoFocus />
      </div>
      <div className="field">
        <label>Environment label</label>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="field">
        <label>Base URL</label>
        <input className="input" value={url} onChange={(event) => setUrl(event.target.value)} />
      </div>

      {error ? <div className="errbox" style={{ marginTop: 8 }}>{error}</div> : null}

      <div className="row right" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void doSave()} disabled={saving || !canSave}>
          {saving ? "Saving…" : "Update environment"}
        </Button>
      </div>
    </Modal>
  );
}
