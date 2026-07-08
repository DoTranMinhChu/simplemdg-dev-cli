import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { studioApi } from "../../api/studio-api-client";
import { useStudioStore } from "../../state/studio-store";
import type { TStudioSettings } from "../../api/studio-api-types";

export function SettingsModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { toast } = useStudioStore();
  const [settings, setSettings] = useState<TStudioSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    studioApi
      .getSettings()
      .then((response) => setSettings(response.settings))
      .catch(() => undefined);
  }, []);

  const save = async (): Promise<void> => {
    if (!settings) return;
    setSaving(true);
    try {
      await studioApi.saveSettings(settings);
      toast("Settings saved.");
      onClose();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} width={440}>
      <h3>Settings</h3>
      {!settings ? (
        <div className="note">Loading...</div>
      ) : (
        <>
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input type="checkbox" checked={settings.restoreWorkspace} onChange={(event) => setSettings({ ...settings, restoreWorkspace: event.target.checked })} />
            <span>Restore open tabs on next launch</span>
          </label>
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input type="checkbox" checked={settings.readOnlyByDefault} onChange={(event) => setSettings({ ...settings, readOnlyByDefault: event.target.checked })} />
            <span>Start new sessions in read-only mode</span>
          </label>
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input type="checkbox" checked={settings.autoFormatGeneratedSql} onChange={(event) => setSettings({ ...settings, autoFormatGeneratedSql: event.target.checked })} />
            <span>Auto-format generated SQL</span>
          </label>
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <input type="checkbox" checked={settings.showProductionWarning} onChange={(event) => setSettings({ ...settings, showProductionWarning: event.target.checked })} />
            <span>Show a warning badge for production-like connections</span>
          </label>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Default row limit</label>
              <input
                className="input"
                type="number"
                value={settings.defaultRowLimit}
                onChange={(event) => setSettings({ ...settings, defaultRowLimit: parseInt(event.target.value, 10) || settings.defaultRowLimit })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Default schema</label>
              <input className="input" value={settings.defaultSchema ?? ""} onChange={(event) => setSettings({ ...settings, defaultSchema: event.target.value || undefined })} />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Query timeout (ms)</label>
              <input
                className="input"
                type="number"
                value={settings.queryTimeoutMs}
                onChange={(event) => setSettings({ ...settings, queryTimeoutMs: parseInt(event.target.value, 10) || settings.queryTimeoutMs })}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Auto-save delay (ms)</label>
              <input
                className="input"
                type="number"
                value={settings.autoSaveDelayMs}
                onChange={(event) => setSettings({ ...settings, autoSaveDelayMs: parseInt(event.target.value, 10) || settings.autoSaveDelayMs })}
              />
            </div>
          </div>
          <div className="field">
            <label>Max history items</label>
            <input
              className="input"
              type="number"
              value={settings.maxHistoryItems}
              onChange={(event) => setSettings({ ...settings, maxHistoryItems: parseInt(event.target.value, 10) || settings.maxHistoryItems })}
            />
          </div>
          <div className="row right" style={{ marginTop: 10 }}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
