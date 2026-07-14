import { useEffect } from "react";
import { createPortal } from "react-dom";
import { TurnBlock } from "./TurnBlock";
import { useConversationPreferences, type TReaderSettings } from "./conversation-preferences";
import { useAiStudioStore } from "../state/ai-studio-store";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import type { TAiObservation, TAiSession, TAiTurn } from "../../../api/ai-studio-api-types";

const TEXT_SIZES: Record<TReaderSettings["textSize"], number> = { sm: 14, md: 16, lg: 18 };
const CONTENT_WIDTHS: Record<TReaderSettings["contentWidth"], number> = { narrow: 720, normal: 960, wide: 1200 };

/** §9 — distraction-free overlay: session title + conversation only, technical sidebars hidden. */
export function ReaderMode({
  session,
  turns,
  observations,
  onClose,
}: {
  session: TAiSession;
  turns: TAiTurn[];
  observations: TAiObservation[];
  onClose: () => void;
}): React.ReactElement | null {
  const { preferences, updateReader } = useConversationPreferences();
  const { reader } = preferences;
  const { toast } = useAiStudioStore();

  const handleFileLink = (path: string, line?: number): void => {
    aiStudioApi.openFile(session.id, path, line).then((result) => {
      if (!result.ok) toast(result.error ?? "Failed to open file.", "err");
    });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const root = document.getElementById("overlay-root");
  if (!root) return null;

  const realTurns = turns.filter((turn) => !turn.isContext);

  return createPortal(
    <div className={`reader-mode${reader.showTimestamps ? "" : " reader-hide-timestamps"}${reader.compact ? " reader-compact" : ""}`}>
      <div className="reader-toolbar">
        <div className="reader-toolbar-title">
          <strong>{session.title}</strong>
          <span className="note">
            {session.provider} · {session.project} · {new Date(session.startedAt).toLocaleDateString()}
          </span>
        </div>
        <div className="reader-toolbar-actions">
          <label className="note">
            Text
            <select value={reader.textSize} onChange={(event) => updateReader({ textSize: event.target.value as TReaderSettings["textSize"] })}>
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
            </select>
          </label>
          <label className="note">
            Width
            <select value={reader.contentWidth} onChange={(event) => updateReader({ contentWidth: event.target.value as TReaderSettings["contentWidth"] })}>
              <option value="narrow">Narrow</option>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
            </select>
          </label>
          <label className="note">
            <input type="checkbox" checked={reader.showToolActivity} onChange={(event) => updateReader({ showToolActivity: event.target.checked })} /> Tool activity
          </label>
          <label className="note">
            <input type="checkbox" checked={reader.showTimestamps} onChange={(event) => updateReader({ showTimestamps: event.target.checked })} /> Timestamps
          </label>
          <label className="note">
            <input type="checkbox" checked={reader.compact} onChange={(event) => updateReader({ compact: event.target.checked })} /> Compact
          </label>
          <button type="button" onClick={onClose}>
            Close Reader Mode
          </button>
        </div>
      </div>
      <div className="reader-column" style={{ fontSize: TEXT_SIZES[reader.textSize], maxWidth: CONTENT_WIDTHS[reader.contentWidth] }}>
        {realTurns.map((turn) => (
          <TurnBlock key={turn.id} turn={turn} observations={observations} focusMode={reader.showToolActivity ? "combined" : "conversation"} onFileLink={handleFileLink} />
        ))}
      </div>
    </div>,
    root,
  );
}
