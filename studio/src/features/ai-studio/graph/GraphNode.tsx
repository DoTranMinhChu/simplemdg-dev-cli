import { forwardRef } from "react";
import { observationTypeIcon } from "../observation-icon";
import type { TGraphNode } from "./graph-model";

function kindLabel(kind: string): string {
  return kind.replace(/-/g, " ");
}

/** A single graph card — rendered twice per layout pass: once hidden (to measure real size), once positioned. Forwards a ref so the measuring pass can read offsetWidth/offsetHeight. */
export const GraphNode = forwardRef<HTMLDivElement, { node: TGraphNode; style?: React.CSSProperties; dim?: boolean; onClick?: (event: React.MouseEvent) => void }>(
  function GraphNode({ node, style, dim, onClick }, ref) {
    return (
      <div
        ref={ref}
        className={`ai-graph-node kind-${node.kind}${node.isError ? " failed" : ""}${dim ? " dim" : ""}`}
        style={style}
        onClick={onClick}
        title={node.label}
      >
        <div className="ai-graph-node-head">
          <span className="ai-graph-node-glyph">{observationTypeIcon(node.kind)}</span>
          <span className="ai-graph-node-kind">{kindLabel(node.kind)}</span>
        </div>
        <div className="ai-graph-node-label">{node.label}</div>
        {node.meta ? <div className="ai-graph-node-meta">{node.meta}</div> : null}
      </div>
    );
  },
);
