import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchInput } from "../../../components/common/SearchInput";
import { aiStudioApi, type TProjectOption } from "../../../api/ai-studio-api-client";

/**
 * Searchable project filter — replaces the missing project dropdown. `aiStudioApi.getProjects()`
 * already existed and was already fully wired end to end server-side; this is the first UI
 * consumer of it. Borrows ContextMenu's portal/viewport-clamp/outside-click-close pattern locally
 * (rather than generalizing that shared component to support an embedded search input) since it
 * anchors to a trigger button's rect, not a click position.
 *
 * `value`/`onChange` operate on `cwd` (the real project identity), not the display name — two
 * projects can share a folder basename, so selecting/highlighting by name would pick both.
 */
export function ProjectPicker({ value, onChange }: { value: string | undefined; onChange: (cwd: string | undefined) => void }): React.ReactElement {
  const [projects, setProjects] = useState<TProjectOption[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });

  useEffect(() => {
    aiStudioApi
      .getProjects()
      .then((response) => setProjects(response.projects))
      .catch(() => undefined);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = popover?.offsetWidth ?? 280;
    const height = popover?.offsetHeight ?? 360;
    setPosition({
      left: Math.min(rect.left, window.innerWidth - width - 8),
      top: Math.min(rect.bottom + 4, window.innerHeight - height - 8),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocumentClick = (): void => setOpen(false);
    // Scroll events from the popover's own scrollable list bubble up to `document` during the
    // capture phase too — without this guard, scrolling the list closes it after ~1 line (same
    // bug as GraphDetailPopup.tsx). Only a scroll *outside* the popover (e.g. panning the page
    // behind it) should close it.
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

  const filtered = projects.filter((option) => option.project.toLowerCase().includes(search.toLowerCase()));
  const overlayRoot = document.getElementById("overlay-root");
  const selectedLabel = value ? (projects.find((option) => option.cwd === value)?.project ?? value) : "All projects";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ai-project-picker-trigger"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <span className="ai-project-picker-trigger-label">{selectedLabel}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && overlayRoot
        ? createPortal(
            <div ref={popoverRef} className="ai-project-picker-popover" style={{ position: "fixed", left: position.left, top: position.top }} onClick={(event) => event.stopPropagation()}>
              <div style={{ padding: 6 }}>
                <SearchInput value={search} onChange={setSearch} placeholder="Search projects..." />
              </div>
              <div className="ai-project-picker-list">
                <div
                  className={`ai-project-picker-item${!value ? " active" : ""}`}
                  onClick={() => {
                    onChange(undefined);
                    setOpen(false);
                  }}
                >
                  <span>All projects</span>
                </div>
                {filtered.map((option) => (
                  <div
                    key={option.cwd}
                    className={`ai-project-picker-item${value === option.cwd ? " active" : ""}`}
                    title={option.cwd}
                    onClick={() => {
                      onChange(option.cwd);
                      setOpen(false);
                    }}
                  >
                    <span>{option.project}</span>
                    <span className="ai-project-picker-item-count">{option.sessionCount}</span>
                  </div>
                ))}
                {!filtered.length ? <div className="tnote">No projects match.</div> : null}
              </div>
            </div>,
            overlayRoot,
          )
        : null}
    </>
  );
}
