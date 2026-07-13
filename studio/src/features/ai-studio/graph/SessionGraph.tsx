import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAiStudioStore } from "../state/ai-studio-store";
import { observationsForTurn } from "../observations-for-turn";
import { buildGraphModel, buildVisibleGraph } from "./graph-model";
import { runDagreLayout, type TGraphLayout } from "./graph-layout";
import { GraphNode } from "./GraphNode";
import { GraphToolbar } from "./GraphToolbar";
import { GraphDetailPopup } from "./GraphDetailPopup";
import type { TGraphNode } from "./graph-model";
import type { TAiObservation, TAiTurn } from "../../../api/ai-studio-api-types";

type TCamera = { x: number; y: number; zoom: number };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function zoomAt(camera: TCamera, cursorX: number, cursorY: number, factor: number): TCamera {
  const nextZoom = clamp(camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const scale = nextZoom / camera.zoom;
  return { x: cursorX - (cursorX - camera.x) * scale, y: cursorY - (cursorY - camera.y) * scale, zoom: nextZoom };
}

function matchesSearch(node: TGraphNode, query: string): boolean {
  if (!query.trim()) return true;
  const needle = query.trim().toLowerCase();
  return (
    node.label.toLowerCase().includes(needle) ||
    node.observation.name.toLowerCase().includes(needle) ||
    node.observation.input.toLowerCase().includes(needle) ||
    node.observation.output.toLowerCase().includes(needle)
  );
}

/** Per-turn execution graph: dagre lays out node positions (measured from real rendered DOM), everything else — pan/zoom/fit, edges, the detail popup — is hand-rolled, matching this codebase's zero-extra-deps convention (the one exception being @dagrejs/dagre itself, for layout math only). */
export function SessionGraph({ sessionId, turns, observations }: { sessionId: string; turns: TAiTurn[]; observations: TAiObservation[] }): React.ReactElement {
  const { selectSession, toast } = useAiStudioStore();
  const defaultTurn = useMemo(() => [...turns].reverse().find((turn) => !turn.isContext) ?? turns[0], [turns]);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | undefined>(defaultTurn?.index);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [camera, setCamera] = useState<TCamera>({ x: 0, y: 0, zoom: 1 });
  const [layout, setLayout] = useState<TGraphLayout | undefined>();
  const [selectedNode, setSelectedNode] = useState<{ node: TGraphNode; rect: DOMRect } | undefined>();

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<{ startClientX: number; startClientY: number; startCamX: number; startCamY: number } | null>(null);

  const selectedTurn = turns.find((turn) => turn.index === selectedTurnIndex) ?? defaultTurn;

  const scopedObservations = useMemo(() => (selectedTurn ? observationsForTurn(observations, selectedTurn) : []), [observations, selectedTurn]);
  const fullModel = useMemo(() => buildGraphModel(scopedObservations), [scopedObservations]);
  const visibleModel = useMemo(() => buildVisibleGraph(fullModel, hiddenKinds), [fullModel, hiddenKinds]);
  const kinds = useMemo(() => [...new Set(fullModel.nodes.map((node) => node.kind))], [fullModel]);

  const copy = (text: string, label: string): void => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}`);
  };

  const fitToBounds = (bounds: TGraphLayout["bounds"]): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width <= 0 || height <= 0 || rect.width === 0 || rect.height === 0) {
      setCamera({ x: rect.width / 2, y: rect.height / 2, zoom: 1 });
      return;
    }
    const padding = 30;
    const zoom = clamp(Math.min((rect.width - padding * 2) / width, (rect.height - padding * 2) / height), MIN_ZOOM, 1.3);
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    setCamera({ x: rect.width / 2 - centerX * zoom, y: rect.height / 2 - centerY * zoom, zoom });
  };

  // Measure real rendered card sizes, then run dagre — never depends on `layout`/`camera`, so setting
  // them here can't retrigger this effect (no infinite re-layout loop).
  useLayoutEffect(() => {
    const sizes = new Map<string, { width: number; height: number }>();
    for (const node of visibleModel.nodes) {
      const element = nodeRefs.current.get(node.id);
      if (element) sizes.set(node.id, { width: element.offsetWidth || 170, height: element.offsetHeight || 46 });
    }
    const result = runDagreLayout(visibleModel, sizes);
    setLayout(result);
    fitToBounds(result.bounds);
    setSelectedNode(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleModel]);

  // Real (non-passive) wheel listener — React's synthetic wheel handler is passive by default and
  // won't reliably block page-scroll-while-zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      setCamera((prev) => zoomAt(prev, event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  const onCanvasPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest(".ai-graph-node")) return;
    dragRef.current = { startClientX: event.clientX, startClientY: event.clientY, startCamX: camera.x, startCamY: camera.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onCanvasPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    setCamera((prev) => ({ ...prev, x: drag.startCamX + (event.clientX - drag.startClientX), y: drag.startCamY + (event.clientY - drag.startClientY) }));
  };

  const onCanvasPointerUp = (): void => {
    dragRef.current = null;
  };

  const toggleKind = (kind: string): void => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const zoomToolbar = (factor: number): void => {
    const rect = canvasRef.current?.getBoundingClientRect();
    setCamera((prev) => zoomAt(prev, (rect?.width ?? 0) / 2, (rect?.height ?? 0) / 2, factor));
  };

  if (!turns.length || !selectedTurn) return <EmptyState>No turns recorded.</EmptyState>;

  const sceneWidth = layout ? Math.max(layout.bounds.right + 40, 40) : 40;
  const sceneHeight = layout ? Math.max(layout.bounds.bottom + 40, 40) : 40;

  return (
    <div className="ai-graph-tab">
      <GraphToolbar
        turns={turns}
        selectedTurnIndex={selectedTurn.index}
        onSelectTurn={setSelectedTurnIndex}
        kinds={kinds}
        hiddenKinds={hiddenKinds}
        onToggleKind={toggleKind}
        search={search}
        onSearchChange={setSearch}
        onZoomIn={() => zoomToolbar(1.2)}
        onZoomOut={() => zoomToolbar(1 / 1.2)}
        onFit={() => layout && fitToBounds(layout.bounds)}
      />

      {!visibleModel.nodes.length ? (
        <EmptyState>No observations in this turn.</EmptyState>
      ) : (
        <div className="ai-graph-canvas" ref={canvasRef} onPointerDown={onCanvasPointerDown} onPointerMove={onCanvasPointerMove} onPointerUp={onCanvasPointerUp} onPointerLeave={onCanvasPointerUp}>
          {/* Hidden measuring pass — real DOM size drives the dagre layout above, never estimated. */}
          <div style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", left: 0, top: 0 }}>
            {visibleModel.nodes.map((node) => (
              <GraphNode key={node.id} node={node} ref={(element) => (element ? nodeRefs.current.set(node.id, element) : nodeRefs.current.delete(node.id))} />
            ))}
          </div>

          {layout ? (
            <div className="ai-graph-scene" style={{ width: sceneWidth, height: sceneHeight, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}>
              <svg className="ai-graph-edges" width={sceneWidth} height={sceneHeight}>
                {visibleModel.edges.map((edge) => {
                  const source = layout.positions.get(edge.source);
                  const target = layout.positions.get(edge.target);
                  if (!source || !target) return null;
                  const x1 = source.left + source.width / 2;
                  const y1 = source.top + source.height;
                  const x2 = target.left + target.width / 2;
                  const y2 = target.top;
                  const midY = (y1 + y2) / 2;
                  return <path key={edge.id} className={`ai-graph-edge${edge.delegation ? " delegation" : ""}`} d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`} />;
                })}
              </svg>
              {visibleModel.nodes.map((node) => {
                const rect = layout.positions.get(node.id);
                if (!rect) return null;
                return (
                  <GraphNode
                    key={node.id}
                    node={node}
                    dim={!matchesSearch(node, search)}
                    style={{ position: "absolute", left: rect.left, top: rect.top, width: rect.width }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedNode({ node, rect: event.currentTarget.getBoundingClientRect() });
                    }}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
      )}

      {selectedNode ? (
        <GraphDetailPopup
          node={selectedNode.node}
          anchorRect={selectedNode.rect}
          sessionId={sessionId}
          onClose={() => setSelectedNode(undefined)}
          onCopy={copy}
          onViewSubagentSession={selectSession}
        />
      ) : null}
    </div>
  );
}
