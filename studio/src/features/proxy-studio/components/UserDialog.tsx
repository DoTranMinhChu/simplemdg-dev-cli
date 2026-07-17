import { useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { proxyStudioApi } from "../api/proxy-studio-api-client";

export type TUserDialogMode = "add" | "update" | "delete";

/** One modal, three modes — mirrors the reference dashboard's single user dialog instead of separate forms. */
export function UserDialog({
  envId,
  envLabel,
  mode,
  initialUserID,
  onClose,
  onDone,
}: {
  envId: string;
  envLabel: string;
  mode: TUserDialogMode;
  initialUserID: string;
  onClose: () => void;
  onDone: () => void;
}): React.ReactElement {
  const [userID, setUserID] = useState(mode === "add" ? "" : initialUserID);
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const title = mode === "add" ? "Add user" : mode === "update" ? "Update user" : "Delete user";

  const revealPassword = async (): Promise<void> => {
    setError("");
    setRevealing(true);
    try {
      const result = await proxyStudioApi.revealUserPassword(envId, initialUserID);
      if (!result.password) {
        setError(result.error ?? "Could not reveal the password.");
        return;
      }
      setPassword(result.password);
      setPasswordVisible(true);
    } catch (revealError) {
      setError(revealError instanceof Error ? revealError.message : String(revealError));
    } finally {
      setRevealing(false);
    }
  };

  const submit = async (): Promise<void> => {
    setError("");

    if (mode !== "delete" && !userID.trim()) {
      setError("User ID is required.");
      return;
    }
    if (mode === "add" && !password.trim()) {
      setError("Password is required.");
      return;
    }

    setSaving(true);
    try {
      if (mode === "delete") {
        await proxyStudioApi.deleteUser(envId, initialUserID);
      } else if (mode === "add") {
        const result = await proxyStudioApi.saveUser({ envId, userID: userID.trim(), password });
        if (!result.saved) {
          setError(result.error ?? "Could not save the user.");
          return;
        }
      } else {
        const result = await proxyStudioApi.updateUser({
          envId,
          originalUserID: initialUserID,
          userID: userID.trim(),
          password: password.trim() || undefined,
        });
        if (!result.saved) {
          setError(result.error ?? "Could not update the user.");
          return;
        }
      }

      onDone();
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={420}>
      <h3>{title}</h3>
      <div className="note" style={{ marginBottom: 12 }}>{envLabel}</div>

      {mode === "delete" ? (
        <div className="note">
          Delete user <strong>{initialUserID}</strong>? This cannot be undone.
        </div>
      ) : (
        <>
          <div className="field">
            <label>User ID</label>
            <input className="input" value={userID} onChange={(event) => setUserID(event.target.value)} autoFocus />
          </div>
          <div className="field">
            <label>Password{mode === "update" ? " (leave blank to keep the current one)" : ""}</label>
            <div className="row">
              <input
                className="input"
                type={passwordVisible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                style={{ flex: 1 }}
              />
              {mode === "update" ? (
                <Button variant="ghost" size="sm" onClick={() => void revealPassword()} disabled={revealing}>
                  {revealing ? "…" : "👁 Show current"}
                </Button>
              ) : null}
            </div>
          </div>
        </>
      )}

      {error ? <div className="errbox" style={{ marginTop: 8 }}>{error}</div> : null}

      <div className="row right" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant={mode === "delete" ? "danger" : "primary"} onClick={() => void submit()} disabled={saving}>
          {saving ? "Working…" : title}
        </Button>
      </div>
    </Modal>
  );
}
