import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchInput } from "../../../components/common/SearchInput";
import { aiStudioApi } from "../../../api/ai-studio-api-client";

type TProjectOption = { project: string; sessionCount: number };

/**
 * Searchable project filter — replaces the missing project dropdown. `aiStudioApi.getProjects()`
 * already existed and was already fully wired end to end server-side; this is the first UI
 * consumer of it. Borrows ContextMenu's portal/viewport-clamp/outside-click-close pattern locally
 * (rather than generalizing that shared component to support an embedded search input) since it
 * anchors to a trigger button's rect, not a click position.
 */
export function ProjectPicker({ value, onChange }: { value: string | undefined; onChange: (project: string | undefined) => void }): React.ReactElement {
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
    const onScroll = (): void => setOpen(false);
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
        <span className="ai-project-picker-trigger-label">{value || "All projects"}</span>
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
                    key={option.project}
                    className={`ai-project-picker-item${value === option.project ? " active" : ""}`}
                    onClick={() => {
                      onChange(option.project);
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
