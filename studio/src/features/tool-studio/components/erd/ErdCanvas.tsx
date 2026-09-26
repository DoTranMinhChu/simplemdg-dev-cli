import { memo, useEffect, useMemo } from "react";
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, useStoreApi } from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Icon } from "../../../../components/common/Icon";
import { ERD_KIND_LABEL, erdEntityMatches } from "./erd-types";
import type { TErdEdge, TErdEntity, TErdField, TErdFocusRequest } from "./erd-types";
import { buildErdTree, computeErdLayout, ERD_NODE_WIDTH, erdNodeHeight, erdVisibleRows } from "./erd-layout";

/**
 * The React Flow canvas half of `ErdWorkspace` — lazy-loaded by it, so React Flow only downloads
 * when someone actually opens a model editor. Layout comes from `erd-layout.ts` (packed tree, root
 * on the left); the user can drag nodes, and "Auto-layout" (a new `relayoutToken`) or any
 * structural change (entities/edges added/removed) re-runs it.
 */

/** Below this zoom node text is unreadable — opening the editor there would just show confetti, so start at the root instead. */
const MIN_READABLE_FIT_ZOOM = 0.5;
const START_ZOOM = 0.7;

type TEntityNodeData = { entity: TErdEntity; rows: TErdField[]; hiddenCount: number; dimmed: boolean };
type TEntityNode = Node<TEntityNodeData, "entity">;

const EntityNode = memo(function EntityNode({ data, selected }: NodeProps<TEntityNode>): React.ReactElement {
  const { entity, rows, hiddenCount, dimmed } = data;
  const badge = ERD_KIND_LABEL[entity.kind];
  return (
    <div className={`erd-node kind-${entity.kind}${selected ? " selected" : ""}${dimmed ? " dimmed" : ""}`} style={{ width: ERD_NODE_WIDTH }}>
      <Handle type="target" position={Position.Left} className="erd-handle" isConnectable={false} />
      <div className="erd-node-header">
        <div className="erd-node-title" title={entity.title}>{entity.title || "(unnamed)"}</div>
        <div className="erd-node-meta">
          {badge && <span className="erd-node-badge">{badge}</span>}
          <span>{entity.fields.length} field{entity.fields.length === 1 ? "" : "s"}</span>
          {entity.subtitle && <span className="erd-node-subtitle" title={entity.subtitle}>{entity.subtitle}</span>}
        </div>
      </div>
      <div className="erd-node-rows">
        {rows.map((field, index) => (
          <div className={`erd-node-row${field.isKey ? " key" : ""}`} key={`${field.name}-${index}`}>
            <span className="erd-node-key">{field.isKey && <Icon name="key" />}</span>
            <span className="erd-node-field" title={field.name}>{field.name || "—"}</span>
            <span className="erd-node-type">{field.type}</span>
          </div>
        ))}
        {hiddenCount > 0 && <div className="erd-node-more">+{hiddenCount} more field{hiddenCount === 1 ? "" : "s"}</div>}
      </div>
      <Handle type="source" position={Position.Right} className="erd-handle" isConnectable={false} />
    </div>
  );
});

const NODE_TYPES = { entity: EntityNode };

export type TErdCanvasProps = {
  entities: TErdEntity[];
  edges: TErdEdge[];
  rootId: string | undefined;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  keysOnly: boolean;
  showBackLinks: boolean;
  search: string;
  relayoutToken: number;
  focusRequest: TErdFocusRequest | undefined;
};

function ErdCanvasInner({ entities, edges, rootId, selectedId, onSelect, keysOnly, showBackLinks, search, relayoutToken, focusRequest }: TErdCanvasProps): React.ReactElement {
  const { fitView, setCenter, setViewport, getNode } = useReactFlow();
  const store = useStoreApi();
  const [nodes, setNodes, onNodesChange] = useNodesState<TEntityNode>([]);
  const query = search.trim().toLowerCase();

  // Structural identity only — editing a field's name/type/label must NOT re-run the layout and
  // throw away where the user dragged things; adding/removing an entity or a relation should.
  const structureKey = useMemo(
    () => `${keysOnly}|${rootId}|${entities.map((entity) => entity.id).join(",")}|${edges.map((edge) => `${edge.source}>${edge.target}`).join(",")}`,
    [entities, edges, keysOnly, rootId],
  );
  const tree = useMemo(() => buildErdTree(entities, edges, rootId), [structureKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeData = (entity: TErdEntity): TEntityNodeData => ({ entity, ...erdVisibleRows(entity, keysOnly), dimmed: Boolean(query) && !erdEntityMatches(entity, query) });

  useEffect(() => {
    const positions = computeErdLayout(entities, tree, keysOnly);
    setNodes(entities.map((entity) => ({ id: entity.id, type: "entity", position: positions.get(entity.id) ?? { x: 0, y: 0 }, data: makeData(entity), selected: entity.id === selectedId })));

    let maxX = 0;
    let maxY = 0;
    for (const entity of entities) {
      const position = positions.get(entity.id) ?? { x: 0, y: 0 };
      maxX = Math.max(maxX, position.x + ERD_NODE_WIDTH);
      maxY = Math.max(maxY, position.y + erdNodeHeight(entity, keysOnly));
    }
    const frame = window.requestAnimationFrame(() => {
      const { width, height } = store.getState();
      const fitZoom = maxX && maxY && width && height ? Math.min(width / (maxX * 1.1), height / (maxY * 1.1)) : 1;
      if (fitZoom >= MIN_READABLE_FIT_ZOOM) void fitView({ padding: 0.08, duration: 250, maxZoom: 1 });
      else void setViewport({ x: 32, y: 32, zoom: START_ZOOM }, { duration: 250 });
    });
    return () => window.cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, relayoutToken]);

  // Content-only changes (field edits, selection, search) patch node data in place, keeping positions.
  useEffect(() => {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    setNodes((prev) =>
      prev.map((node) => {
        const entity = byId.get(node.id);
        return entity ? { ...node, data: makeData(entity), selected: node.id === selectedId } : node;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities, selectedId, query]);

  useEffect(() => {
    if (!focusRequest) return;
    const node = getNode(focusRequest.id);
    if (!node) return;
    const height = node.measured?.height ?? 200;
    void setCenter(node.position.x + ERD_NODE_WIDTH / 2, node.position.y + height / 2, { zoom: 0.9, duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.token]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges
        .filter((edge) => showBackLinks || !tree.backLinkEdgeIds.has(edge.id))
        .map((edge) => {
          const related = edge.source === selectedId || edge.target === selectedId;
          const backLink = tree.backLinkEdgeIds.has(edge.id);
          return {
            id: edge.id,
            source: edge.source,
            target: edge.target,
            label: `${edge.cardinality === "many" ? "*" : "1"}  ${edge.label}`,
            className: `erd-edge kind-${edge.kind}${related ? " related" : ""}${backLink ? " back-link" : ""}`,
            markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 4,
          };
        }),
    [edges, selectedId, showBackLinks, tree],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelect(node.id)}
      onEdgeClick={(_, edge) => onSelect(edge.source)}
      nodesConnectable={false}
      colorMode="dark"
      minZoom={0.05}
      maxZoom={2}
      onlyRenderVisibleElements
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} fitViewOptions={{ padding: 0.08, duration: 250 }} />
      <MiniMap pannable zoomable nodeClassName={(node) => `erd-minimap-node kind-${(node.data as TEntityNodeData).entity.kind}`} />
    </ReactFlow>
  );
}

export default function ErdCanvas(props: TErdCanvasProps): React.ReactElement {
  return (
    <ReactFlowProvider>
      <ErdCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
