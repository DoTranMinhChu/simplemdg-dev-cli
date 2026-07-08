import { useEffect } from "react";
import { createPortal } from "react-dom";

export type TModalProps = {
  onClose: () => void;
  children: React.ReactNode;
  width?: number;
};

/** Renders into #overlay-root so it's never clipped by a scrolling ancestor. Escape and backdrop-click both close it. */
export function Modal({ onClose, children, width }: TModalProps): React.ReactElement | null {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const root = document.getElementById("overlay-root");
  if (!root) return null;

  return createPortal(
    <div
      className="modal"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" style={width ? { width } : undefined}>
        {children}
      </div>
    </div>,
    root,
  );
}
