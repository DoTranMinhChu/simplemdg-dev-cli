import { useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { useAiStudioStore } from "../state/ai-studio-store";
import { INCLUDE_KEYS, INCLUDE_LABELS, PRESET_LABELS, includeForPreset, matchingPreset } from "./export-presets";
import type { TAiExportFormat, TAiExportInclude, TAiExportPreset, TAiExportPreview } from "../../../api/ai-studio-api-types";

/** "pdf" only ever exists in this dialog — it's the html export opened for the browser's print dialog. */
type TDialogFormat = TAiExportFormat | "pdf";

const FORMAT_LABELS: Record<TDialogFormat, string> = { pdf: "PDF", html: "HTML", markdown: "Markdown", json: "JSON", zip: "ZIP (share package)" };
const FORMATS: TDialogFormat[] = ["pdf", "html", "markdown", "json", "zip"];
const PRESETS: TAiExportPreset[] = ["conversation", "learning", "engineering", "full", "custom"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ExportDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [format, setFormat] = useState<TDialogFormat>("markdown");
  const [preset, setPreset] = useState<TAiExportPreset>("learning");
  const [include, setInclude] = useState<TAiExportInclude>(() => includeForPreset("learning"));
  const [redactSecrets, setRedactSecrets] = useState(true);
  const [includeLocalPaths, setIncludeLocalPaths] = useState(false);
  const [preview, setPreview] = useState<TAiExportPreview | undefined>();
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const applyPreset = (next: TAiExportPreset): void => {
    setPreset(next);
    setInclude(includeForPreset(next, include));
    setPreview(undefined);
  };

  const toggleInclude = (key: keyof TAiExportInclude): void => {
    const next = { ...include, [key]: !include[key] };
    setInclude(next);
    setPreset(matchingPreset(next));
    setPreview(undefined);
  };

  const buildInput = (wireFormat: TAiExportFormat) => ({
    format: wireFormat,
    preset,
    include,
    redactSecrets,
    includeLocalPaths,
    theme: "dark" as const,
  });

  const runPreview = async (): Promise<void> => {
    setPreviewLoading(true);
    try {
      const wireFormat = format === "pdf" ? "html" : format;
      setPreview(await aiStudioApi.previewExport(sessionId, buildInput(wireFormat)));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setPreviewLoading(false);
    }
  };

  const runExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const wireFormat = format === "pdf" ? "html" : format;
      const { blob, fileName } = await aiStudioApi.runExport(sessionId, buildInput(wireFormat));
      const url = URL.createObjectURL(blob);

      if (format === "pdf") {
        const printWindow = window.open(url, "_blank");
        if (printWindow) {
          printWindow.addEventListener("load", () => printWindow.print());
          toast("Opened a print-ready tab — use your browser's Print dialog to save as PDF.");
        } else {
          toast("Pop-up blocked — allow pop-ups for this page, or export as HTML and print it manually.", "warn");
        }
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName ?? `session.${wireFormat}`;
        link.click();
        toast(`Exported ${fileName ?? wireFormat}`);
      }
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal onClose={onClose} width={640}>
      <h3>Export session</h3>

      <div className="export-section">
        <div className="export-label">Format</div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {FORMATS.map((entry) => (
            <button key={entry} type="button" className={`chip${format === entry ? " active" : ""}`} onClick={() => setFormat(entry)}>
              {FORMAT_LABELS[entry]}
            </button>
          ))}
        </div>
      </div>

      <div className="export-section">
        <div className="export-label">Preset</div>
        <select value={preset} onChange={(event) => applyPreset(event.target.value as TAiExportPreset)}>
          {PRESETS.map((entry) => (
            <option key={entry} value={entry}>
              {PRESET_LABELS[entry]}
            </option>
          ))}
        </select>
      </div>

      <div className="export-section">
        <div className="export-label">Include</div>
        <div className="export-checklist">
          {INCLUDE_KEYS.map((key) => (
            <label key={key} className="note">
              <input type="checkbox" checked={include[key]} onChange={() => toggleInclude(key)} /> {INCLUDE_LABELS[key]}
            </label>
          ))}
        </div>
      </div>

      <div className="export-section">
        <div className="export-label">Security</div>
        <label className="note" style={{ display: "block" }}>
          <input type="checkbox" checked={redactSecrets} onChange={(event) => setRedactSecrets(event.target.checked)} /> Redact secrets (recommended)
        </label>
        <label className="note" style={{ display: "block" }}>
          <input type="checkbox" checked={includeLocalPaths} onChange={(event) => setIncludeLocalPaths(event.target.checked)} /> Include local absolute paths
        </label>
      </div>

      {preview ? (
        <div className="export-preview">
          <div>
            <strong>Included:</strong> {preview.sections.included.join(", ") || "(none)"}
          </div>
          {preview.sections.excluded.length ? (
            <div className="note">
              <strong>Excluded:</strong> {preview.sections.excluded.join(", ")}
            </div>
          ) : null}
          <div className="note">
            {preview.redactedFieldCount > 0 ? `${preview.redactedFieldCount} value${preview.redactedFieldCount === 1 ? "" : "s"} will be redacted · ` : ""}
            Estimated size: {formatBytes(preview.estimatedBytes)}
          </div>
        </div>
      ) : null}

      <div className="row right" style={{ marginTop: 14, gap: 8 }}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="sec" disabled={previewLoading} onClick={runPreview}>
          {previewLoading ? "Previewing…" : "Preview"}
        </Button>
        <Button disabled={exporting} onClick={runExport}>
          {exporting ? "Exporting…" : `Export ${FORMAT_LABELS[format]}`}
        </Button>
      </div>
    </Modal>
  );
}
