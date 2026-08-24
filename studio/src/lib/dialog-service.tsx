import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { Button } from "../components/common/Button";

export type TConfirmDialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive (red) and keeps keyboard focus on Cancel instead of
   * Confirm, so a reflexive Enter press right after the dialog opens can't trigger the destructive
   * action by accident. */
  danger?: boolean;
};

export type TPromptDialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  placeholder?: string;
};

type TRequest =
  | { kind: "confirm"; message: React.ReactNode; options: TConfirmDialogOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; message: React.ReactNode; defaultValue: string; options: TPromptDialogOptions; resolve: (value: string | null) => void };

let dispatch: ((request: TRequest | null) => void) | null = null;
let root: Root | null = null;

/**
 * Every studio bundle (DB/Tool/Proxy/AI) already has `#overlay-root` in its HTML for Modal.tsx's
 * portal — deliberately NOT reused here. A second independent React root rendering into a
 * container some OTHER root already manages children of (via createPortal) is a known-fragile
 * pattern: the two roots' reconciliation can stomp on each other's DOM nodes. This gets its own
 * dedicated container instead, so it never touches anything the app's real root manages.
 */
function ensureMounted(): void {
  if (root) return;
  const container = document.createElement("div");
  container.id = "smdg-dialog-root";
  document.body.appendChild(container);
  root = createRoot(container);
  // flushSync guarantees DialogHost's mount effect (which captures `dispatch`) has already run by
  // the time this returns — without it, a confirmDialog()/promptDialog() call made immediately
  // after the very first mount could dispatch before the effect registers, silently hanging the
  // returned promise forever (dispatch would still be null).
  flushSync(() => {
    root!.render(<DialogHost />);
  });
}

function DialogHost(): React.ReactElement | null {
  const [request, setRequest] = useState<TRequest | null>(null);
  const [inputValue, setInputValue] = useState("");

  useEffect(() => {
    dispatch = setRequest;
    return () => {
      dispatch = null;
    };
  }, []);

  useEffect(() => {
    if (request?.kind === "prompt") setInputValue(request.defaultValue);
  }, [request]);

  useEffect(() => {
    if (!request) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request]);

  if (!request) return null;

  function finish(confirmed: boolean): void {
    if (request!.kind === "confirm") request!.resolve(confirmed);
    else request!.resolve(confirmed ? inputValue.trim() : null);
    setRequest(null);
  }

  const { message, options } = request;
  const danger = request.kind === "confirm" && Boolean(request.options.danger);
  const cancelLabel = options.cancelLabel ?? "Cancel";
  const confirmLabel = options.confirmLabel ?? (request.kind === "prompt" ? "Save" : "OK");

  return (
    <div
      className="modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) finish(false);
      }}
    >
      <div className="dialog" style={{ width: 440 }}>
        {options.title ? <h3>{options.title}</h3> : null}
        <div style={{ whiteSpace: "pre-line", lineHeight: 1.5, marginBottom: request.kind === "prompt" ? 12 : 18 }}>{message}</div>
        {request.kind === "prompt" ? (
          <input
            className="input"
            autoFocus
            value={inputValue}
            placeholder={request.options.placeholder}
            onChange={(event) => setInputValue(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                finish(true);
              }
            }}
            style={{ marginBottom: 18 }}
          />
        ) : null}
        <div className="row right">
          <Button variant="ghost" autoFocus={danger} onClick={() => finish(false)}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "danger" : "primary"} autoFocus={!danger} onClick={() => finish(true)}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Drop-in replacement for `window.confirm()` — same "await a yes/no answer" shape, but rendered
 * as an in-app dialog matching the rest of the UI instead of the browser's own unstyled native
 * popup (which also blocks the whole tab, can't be labeled per-action, and looks jarring next to
 * a dark-themed app). `message` accepts JSX for the rare case worth more than plain text (e.g. a
 * color-coded change breakdown) — pass a plain string for everything else.
 */
export function confirmDialog(message: React.ReactNode, options: TConfirmDialogOptions = {}): Promise<boolean> {
  ensureMounted();
  return new Promise((resolve) => {
    dispatch?.({ kind: "confirm", message, options, resolve });
  });
}

/** Drop-in replacement for `window.prompt()` — resolves the trimmed input, or `null` on cancel/Escape (never an empty-string vs. null ambiguity). */
export function promptDialog(message: React.ReactNode, defaultValue = "", options: TPromptDialogOptions = {}): Promise<string | null> {
  ensureMounted();
  return new Promise((resolve) => {
    dispatch?.({ kind: "prompt", message, defaultValue, options, resolve });
  });
}
