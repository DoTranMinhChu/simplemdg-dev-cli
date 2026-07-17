import { useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { proxyStudioApi, type TProxyImportResult } from "../api/proxy-studio-api-client";

type TParsedExport = { environments: unknown[] };

/** Imports a JSON file produced by "Export" (here or via `smdg proxy export`) — merges by
 * default so re-running it is always safe: an existing user's password is never overwritten
 * by whatever an imported file happens to carry. */
export function ImportEnvironmentsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }): React.ReactElement {
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<TParsedExport | undefined>();
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<TProxyImportResult | undefined>();

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError("");
    setResult(undefined);
    setFileName(file.name);

    try {
      const text = await file.text();
      const json = JSON.parse(text) as { environments?: unknown };
      if (!json || !Array.isArray(json.environments)) {
        setError('This file does not look like a "smdg proxy export" (expected an "environments" array).');
        setParsed(undefined);
        return;
      }
      setParsed(json as TParsedExport);
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : String(parseError));
      setParsed(undefined);
    }
  };

  const doImport = async (): Promise<void> => {
    if (!parsed) return;
    setImporting(true);
    setError("");
    try {
      const response = await proxyStudioApi.importConfig(parsed, overwrite);
      if (response.error) {
        setError(response.error);
        return;
      }
      setResult(response);
      onImported();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal onClose={onClose} width={460}>
      <h3>Import Environments</h3>
      <div className="note" style={{ marginBottom: 12 }}>
        From a file made by "Export" (here or <code>smdg proxy export</code>). Merges by default — an existing user's password is never overwritten.
      </div>

      <div className="field">
        <label>JSON file</label>
        <input className="input" type="file" accept="application/json" onChange={(event) => void onFileChange(event)} />
      </div>

      {parsed ? (
        <div className="note" style={{ marginBottom: 8 }}>
          {fileName}: {parsed.environments.length} environment(s) found.
        </div>
      ) : null}

      {!result ? (
        <div className="field">
          <label>
            <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} style={{ marginRight: 6 }} />
            Replace everything instead of merging (discards anything not in this file)
          </label>
        </div>
      ) : null}

      {error ? <div className="errbox" style={{ marginTop: 8 }}>{error}</div> : null}
      {result ? (
        <div className="note" style={{ marginTop: 8 }}>
          Imported: +{result.addedEnvironments} new environment(s), {result.updatedEnvironments} updated, +{result.addedUsers} new user(s)
          {result.skippedUsers > 0 ? `, ${result.skippedUsers} existing user(s) left untouched` : ""}.
        </div>
      ) : null}

      <div className="row right" style={{ marginTop: 14 }}>
        <Button variant="ghost" onClick={onClose}>
          {result ? "Close" : "Cancel"}
        </Button>
        {!result ? (
          <Button onClick={() => void doImport()} disabled={!parsed || importing}>
            {importing ? "Importing…" : "Import"}
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}
