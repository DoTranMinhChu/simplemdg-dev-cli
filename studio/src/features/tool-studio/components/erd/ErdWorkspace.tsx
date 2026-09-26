import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../../components/common/Button";
import { Spinner } from "../../../../components/common/Spinner";
import { SearchInput } from "../../../../components/common/SearchInput";
import { erdEntityMatches } from "./erd-types";
import type { TErdEdge, TErdEntity, TErdFocusRequest } from "./erd-types";
import { buildErdTree } from "./erd-layout";

const ErdCanvas = lazy(() => import("./ErdCanvas"));

const INSPECTOR_WIDTH_KEY = "erd-inspector-width";
const INSPECTOR_DEFAULT_WIDTH = 480;
const INSPECTOR_MIN_WIDTH = 340;

function readStoredWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    return stored >= INSPECTOR_MIN_WIDTH ? stored : INSPECTOR_DEFAULT_WIDTH;
  } catch {
    return INSPECTOR_DEFAULT_WIDTH;
  }
}

/**
 * Shared ERD editor shell: toolbar (entity search, keys-only, back-links, auto-layout, fullscreen,
 * plus the editor's own extra controls/actions), the pan/zoom canvas, and a resizable right-hand
 * inspector the editor fills for whichever entity is selected. Editing itself lives in the
 * inspector — the canvas is for seeing the whole model and picking what to edit.
 */
export function ErdWorkspace({
  entities,
  edges,
  rootId,
  selectedId,
  onSelect,
  inspector,
  toolbarExtra,
  actions,
  focusRequest,
}: {
  entities: TErdEntity[];
  edges: TErdEdge[];
  /** Entity the layout starts from (drawn top-left); defaults to whatever nothing points at. */
  rootId?: string;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  inspector: React.ReactNode;
  toolbarExtra?: React.ReactNode;
  actions?: React.ReactNode;
  /** Lets the editor pan the canvas to an entity it just selected from the inspector (e.g. clicking a relation's target). */
  focusRequest?: TErdFocusRequest;
}): React.ReactElement {
  const [search, setSearch] = useState("");
  const [keysOnly, setKeysOnly] = useState(false);
  const [showBackLinks, setShowBackLinks] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [relayoutToken, setRelayoutToken] = useState(0);
  const [localFocus, setLocalFocus] = useState<TErdFocusRequest | undefined>();
  const [inspectorWidth, setInspectorWidth] = useState(readStoredWidth);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const backLinkCount = useMemo(() => buildErdTree(entities, edges, rootId).backLinkEdgeIds.size, [entities, edges, rootId]);

  // Whichever focus request is newest wins — the editor's (inspector navigation) or the search box's.
  const effectiveFocus = !localFocus ? focusRequest : !focusRequest ? localFocus : localFocus.token > focusRequest.token ? localFocus : focusRequest;

  const query = search.trim().toLowerCase();
  const matchCount = query ? entities.filter((entity) => erdEntityMatches(entity, query)).length : undefined;

  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const body = bodyRef.current;
    if (!body) return;
    const onMove = (moveEvent: PointerEvent): void => {
      const rect = body.getBoundingClientRect();
      const next = Math.min(Math.max(rect.right - moveEvent.clientX, INSPECTOR_MIN_WIDTH), rect.width * 0.7);
      setInspectorWidth(next);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setInspectorWidth((width) => {
        try {
          window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(Math.round(width)));
        } catch {
          // storage unavailable (private mode etc.) — width just won't persist
        }
        return width;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className={`erd-workspace${fullscreen ? " fullscreen" : ""}`}>
      <div className="erd-toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Find entity or field…"
          onEnter={() => {
            const match = entities.find((entity) => erdEntityMatches(entity, query));
            if (!match) return;
            onSelect(match.id);
            setLocalFocus({ id: match.id, token: Date.now() });
          }}
        />
        {matchCount !== undefined && <span className="note">{matchCount} match{matchCount === 1 ? "" : "es"} · Enter to jump</span>}
        <label className="erd-toggle" title="Show only key fields on every entity — the most compact overview">
          <input type="checkbox" checked={keysOnly} onChange={(event) => setKeysOnly(event.target.checked)} /> Keys only
        </label>
        {backLinkCount > 0 && (
          <label className="erd-toggle" title="Associations from a child straight back to its parent (e.g. to_BusinessPartner) — hidden by default, they double the line count without adding structure">
            <input type="checkbox" checked={showBackLinks} onChange={(event) => setShowBackLinks(event.target.checked)} /> Parent links ({backLinkCount})
          </label>
        )}
        {toolbarExtra}
        <Button variant="ghost" size="sm" onClick={() => setRelayoutToken((token) => token + 1)} title="Re-arrange every entity automatically">
          Auto-layout
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setFullscreen((value) => !value)} title={fullscreen ? "Exit fullscreen (Esc)" : "Use the whole window"}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </Button>
        <span className="erd-toolbar-spacer" />
        <span className="note">
          {entities.length} entit{entities.length === 1 ? "y" : "ies"} · {edges.length - backLinkCount} relation{edges.length - backLinkCount === 1 ? "" : "s"}
        </span>
        {actions}
      </div>
      <div className="erd-body" ref={bodyRef} style={{ gridTemplateColumns: `minmax(0, 1fr) 6px ${inspectorWidth}px` }}>
        <div className="erd-canvas">
          <Suspense
            fallback={
              <div className="erd-canvas-loading">
                <Spinner /> loading diagram…
              </div>
            }
          >
            <ErdCanvas
              entities={entities}
              edges={edges}
              rootId={rootId}
              selectedId={selectedId}
              onSelect={onSelect}
              keysOnly={keysOnly}
              showBackLinks={showBackLinks}
              search={search}
              relayoutToken={relayoutToken}
              focusRequest={effectiveFocus}
            />
          </Suspense>
        </div>
        <div className="erd-resizer" role="separator" aria-orientation="vertical" title="Drag to resize the inspector" onPointerDown={startResize} />
        <aside className="erd-inspector">{inspector}</aside>
      </div>
    </div>
  );
}
