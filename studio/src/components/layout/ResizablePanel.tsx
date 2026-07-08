import { useEffect, useRef } from "react";

export type TResizablePanelProps = {
  width: number;
  onWidthChange: (px: number) => void;
  onCommit?: (px: number) => void;
  min?: number;
  max?: number;
  defaultWidth?: number;
};

/** The draggable divider between the sidebar and the workspace. Clamps to [min, max-or-45vw], supports keyboard nudge and double-click reset. */
export function ResizablePanel({ width, onWidthChange, onCommit, min = 260, max = 600, defaultWidth = 320 }: TResizablePanelProps): React.ReactElement {
  const draggingRef = useRef(false);

  useEffect(() => {
    const clamp = (px: number): number => {
      const maxAllowed = Math.min(max, Math.round(window.innerWidth * 0.45));
      return Math.min(maxAllowed, Math.max(min, px));
    };

    const onMouseMove = (event: MouseEvent): void => {
      if (!draggingRef.current) return;
      onWidthChange(clamp(event.clientX));
    };

    const onMouseUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.classList.remove("resizing-sidebar");
      onCommit?.(clamp(width));
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [min, max, width, onWidthChange, onCommit]);

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      tabIndex={0}
      title="Drag to resize · Double-click to reset"
      onMouseDown={(event) => {
        draggingRef.current = true;
        document.body.classList.add("resizing-sidebar");
        event.preventDefault();
      }}
      onDoubleClick={() => {
        onWidthChange(defaultWidth);
        onCommit?.(defaultWidth);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          const next = Math.max(min, width - 20);
          onWidthChange(next);
          onCommit?.(next);
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          const next = Math.min(max, width + 20);
          onWidthChange(next);
          onCommit?.(next);
        } else if (event.key === "Enter") {
          event.preventDefault();
          onWidthChange(defaultWidth);
          onCommit?.(defaultWidth);
        }
      }}
    />
  );
}
