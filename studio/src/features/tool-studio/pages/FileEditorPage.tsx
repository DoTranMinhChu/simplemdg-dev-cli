import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { SpreadsheetEditor } from "../components/SpreadsheetEditor";
import type { TSpreadsheetEditorHandle } from "../components/SpreadsheetEditor";
import { DocEditor } from "../components/DocEditor";
import type { TDocEditorHandle } from "../components/DocEditor";
import {
  isFileSystemAccessSupported,
  openViaDropItem,
  openViaInputFile,
  openViaPicker,
  saveFile,
  type TOpenedFile,
} from "../../../lib/file-editor-source";

export function FileEditorPage(): React.ReactElement {
  const [file, setFile] = useState<TOpenedFile | undefined>();
  const [dirty, setDirty] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | undefined>();

  const spreadsheetRef = useRef<TSpreadsheetEditorHandle>(null);
  const docRef = useRef<TDocEditorHandle>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openFile = useCallback((opened: TOpenedFile | undefined) => {
    if (!opened) return;
    setFile(opened);
    setDirty(false);
    setError(undefined);
    setSavedMessage(undefined);
  }, []);

  const handleOpenClick = useCallback(async () => {
    setError(undefined);
    try {
      const opened = await openViaPicker();
      if (opened) {
        openFile(opened);
        return;
      }
      if (!isFileSystemAccessSupported()) inputRef.current?.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [openFile]);

  const handleInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const inputFile = event.target.files?.[0];
      event.target.value = "";
      if (!inputFile) return;
      setError(undefined);
      try {
        openFile(await openViaInputFile(inputFile));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [openFile],
  );

  const handleDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragActive(false);
      const item = event.dataTransfer.items?.[0];
      if (!item) return;
      setError(undefined);
      try {
        openFile(await openViaDropItem(item));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [openFile],
  );

  const handleSave = useCallback(async () => {
    if (!file) return;
    setSaving(true);
    setError(undefined);
    setSavedMessage(undefined);
    try {
      const bytes = file.kind === "spreadsheet" ? await spreadsheetRef.current?.exportBytes() : await docRef.current?.exportBytes();
      if (!bytes) throw new Error("Editor did not return any content to save.");
      const { savedInPlace } = await saveFile(file, bytes);
      setDirty(false);
      setSavedMessage(savedInPlace ? `Saved ${file.name}.` : `Downloaded ${file.name} (this browser can't write back to the original file in place).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [file]);

  useEffect(() => {
    if (!file) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [file, handleSave]);

  const canSaveInPlace = isFileSystemAccessSupported() && !!file?.handle;

  return (
    <div>
      <div className="ts-header">
        <h1>File Editor</h1>
        <p className="note">Open a local .xlsx or .docx file — drag it in, or use Open file — edit it, and save it back. Basic cells/formulas/multi-sheet for Excel, basic rich text for Word.</p>
      </div>

      <div className="ts-card fe-card">
        <div className="fe-toolbar">
          <Button onClick={() => void handleOpenClick()}>Open file...</Button>
          <input ref={inputRef} type="file" accept=".xlsx,.docx" style={{ display: "none" }} onChange={(event) => void handleInputChange(event)} />
          {file && (
            <>
              <span className="fe-filename">{file.name}</span>
              {dirty && <span className="fe-dirty-dot" title="Unsaved changes" />}
              <Button onClick={() => void handleSave()} disabled={saving}>
                {saving ? "Saving..." : canSaveInPlace ? "Save (Ctrl+S)" : "Download a copy (Ctrl+S)"}
              </Button>
            </>
          )}
        </div>

        {error && <div className="errbox" style={{ marginBottom: 12 }}>{error}</div>}
        {savedMessage && !error && <div className="note" style={{ marginBottom: 12 }}>{savedMessage}</div>}

        {!file ? (
          <div
            className={`fe-dropzone${dragActive ? " active" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => void handleDrop(event)}
          >
            <p>Drag an .xlsx or .docx file here, or use "Open file..." above.</p>
            {!isFileSystemAccessSupported() && <p className="note faint">Your browser doesn't support writing files in place — Save will download a copy instead.</p>}
          </div>
        ) : file.kind === "spreadsheet" ? (
          <SpreadsheetEditor key={file.name} ref={spreadsheetRef} bytes={file.bytes} onDirtyChange={setDirty} />
        ) : (
          <DocEditor key={file.name} ref={docRef} bytes={file.bytes} onDirtyChange={setDirty} />
        )}
      </div>
    </div>
  );
}
