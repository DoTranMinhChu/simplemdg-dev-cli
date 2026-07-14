import { GraphNode } from "./GraphNode";
import type { TGraphNode } from "./graph-model";

/**
 * One row of the collapsible vertical tree: the node card, an expand/collapse chevron when it has
 * children, and (when expanded) its children indented one level deeper. Renders in normal block
 * flow — no canvas/dagre positioning — so "vertical" here just means "stacked", matching a plain
 * file-tree rather than an org-chart.
 */
export function GraphTreeRow({
  nodeId,
  depth,
  nodesById,
  childrenOf,
  childCounts,
  expandedIds,
  dimIds,
  onToggle,
  onSelect,
}: {
  nodeId: string;
  depth: number;
  nodesById: Map<string, TGraphNode>;
  childrenOf: Map<string, string[]>;
  childCounts: Map<string, number>;
  expandedIds: ReadonlySet<string>;
  dimIds: ReadonlySet<string>;
  onToggle: (nodeId: string) => void;
  onSelect: (node: TGraphNode, event: React.MouseEvent) => void;
}): React.ReactElement | null {
  const node = nodesById.get(nodeId);
  if (!node) return null;

  const childCount = childCounts.get(nodeId) ?? 0;
  const isExpanded = expandedIds.has(nodeId);
  const childIds = isExpanded ? (childrenOf.get(nodeId) ?? []) : [];

  return (
    <div className="ai-graph-tree-branch">
      <div className="ai-graph-tree-row" style={{ paddingLeft: depth * 20 }}>
        {childCount > 0 ? (
          <button
            type="button"
            className="ai-graph-tree-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggle(nodeId);
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
            aria-expanded={isExpanded}
          >
            {isExpanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="ai-graph-tree-toggle-spacer" />
        )}
        <GraphNode node={node} dim={dimIds.has(nodeId)} onClick={(event) => onSelect(node, event)} />
        {childCount > 0 ? (
          <span className="ai-graph-tree-count" onClick={() => onToggle(nodeId)}>
            {childCount}
          </span>
        ) : null}
      </div>

      {isExpanded && childIds.length > 0 ? (
        <div className="ai-graph-tree-children">
          {childIds.map((childId) => (
            <GraphTreeRow
              key={childId}
              nodeId={childId}
              depth={depth + 1}
              nodesById={nodesById}
              childrenOf={childrenOf}
              childCounts={childCounts}
              expandedIds={expandedIds}
              dimIds={dimIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
