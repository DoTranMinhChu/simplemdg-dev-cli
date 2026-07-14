import { observationTypeIcon } from "../observation-icon";
import type { TGraphNode } from "./graph-model";

function kindLabel(kind: string): string {
  return kind.replace(/-/g, " ");
}

/** A single graph card — one row in the tree view. Clicking it opens the detail popup (see SessionGraph/GraphTreeRow); this component only renders the card itself. */
export function GraphNode({ node, dim, onClick }: { node: TGraphNode; dim?: boolean; onClick?: (event: React.MouseEvent) => void }): React.ReactElement {
  return (
    <div className={`ai-graph-node kind-${node.kind}${node.isError ? " failed" : ""}${dim ? " dim" : ""}`} onClick={onClick} title={node.label}>
      <div className="ai-graph-node-head">
        <span className="ai-graph-node-glyph">{observationTypeIcon(node.kind)}</span>
        <span className="ai-graph-node-kind">{kindLabel(node.kind)}</span>
      </div>
      <div className="ai-graph-node-label">{node.label}</div>
      {node.meta ? <div className="ai-graph-node-meta">{node.meta}</div> : null}
    </div>
  );
}
