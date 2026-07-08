import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

export type TContextMenuItem =
  | { sep: true }
  | { label: string; icon?: string; danger?: boolean; onClick: () => void };

export type TContextMenuState = { x: number; y: number; items: TContextMenuItem[] };

/** Fixed-position menu clamped to the viewport (flips instead of overflowing near an edge), closed by outside click/scroll/Escape. */
export function ContextMenu({ x, y, items, onClose }: TContextMenuState & { onClose: () => void }): React.ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    setPosition({
      left: Math.min(x, window.innerWidth - width - 8),
      top: Math.min(y, window.innerHeight - height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const onDocumentClick = (): void => onClose();
    const onScroll = (): void => onClose();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const root = document.getElementById("overlay-root");
  if (!root) return null;

  return createPortal(
    <div
      ref={ref}
      className="ctxmenu"
      style={{ left: position.left, top: position.top }}
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item, index) =>
        "sep" in item ? (
          <div key={index} className="ctxsep" />
        ) : (
          <div
            key={index}
            className={`ctxitem${item.danger ? " danger" : ""}`}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.icon ? <Icon name={item.icon} /> : null}
            <span>{item.label}</span>
          </div>
        ),
      )}
    </div>,
    root,
  );
}
