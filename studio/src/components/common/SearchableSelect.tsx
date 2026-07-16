import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchInput } from "./SearchInput";
import { highlightMatch } from "../../lib/highlight-match";

export type TSearchableSelectOption = {
  value: string;
  label: string;
  /** Optional secondary line shown faint below the label (e.g. a repo count, an id). */
  meta?: string;
};

export type TSearchableSelectProps = {
  options: TSearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
};

/**
 * Drop-in replacement for a native `<select>` when the option list can get long (GitLab groups,
 * deploy targets, object types, ...) — a `.select`-styled trigger button that opens a searchable
 * popover instead of the browser's own (unsearchable) dropdown. Mirrors the portal/viewport-clamp/
 * outside-click-close pattern already proven in ai-studio's ProjectPicker, generalized here for
 * reuse across any feature instead of being tied to one.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyMessage = "No options match.",
  disabled,
}: TSearchableSelectProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240 });

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, 240);
    const height = popover?.offsetHeight ?? 320;
    setPosition({
      left: Math.min(rect.left, window.innerWidth - width - 8),
      top: Math.min(rect.bottom + 4, window.innerHeight - height - 8),
      width,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (): void => setOpen(false);
    // Scroll events from the popover's own scrollable list bubble up to `document` during the
    // capture phase — only a scroll *outside* the popover should close it (same guard as
    // ProjectPicker/GraphDetailPopup).
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const lowerSearch = search.toLowerCase();
  const filtered = search ? options.filter((option) => `${option.label} ${option.meta ?? ""}`.toLowerCase().includes(lowerSearch)) : options;
  const overlayRoot = document.getElementById("overlay-root");
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="select ssel-trigger"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <span className={`ssel-trigger-label${selected ? "" : " placeholder"}`}>{selected ? selected.label : placeholder}</span>
        <span className="ssel-chevron" aria-hidden="true">▾</span>
      </button>

      {open && overlayRoot
        ? createPortal(
            <div
              ref={popoverRef}
              className="ssel-popover"
              style={{ position: "fixed", left: position.left, top: position.top, width: position.width }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="ssel-search-wrap">
                <SearchInput value={search} onChange={setSearch} placeholder={searchPlaceholder} autoFocus />
              </div>
              <div className="ssel-list">
                {filtered.map((option) => (
                  <div
                    key={option.value}
                    className={`ssel-item${option.value === value ? " active" : ""}`}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span>{highlightMatch(option.label, search)}</span>
                    {option.meta ? <span className="ssel-item-meta">{option.meta}</span> : null}
                  </div>
                ))}
                {!filtered.length ? <div className="ssel-empty">{emptyMessage}</div> : null}
              </div>
            </div>,
            overlayRoot,
          )
        : null}
    </>
  );
}
