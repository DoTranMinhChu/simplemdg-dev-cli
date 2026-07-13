import dagre from "@dagrejs/dagre";
import type { TGraphModel } from "./graph-model";

export type TLayoutRect = { left: number; top: number; width: number; height: number };

export type TGraphLayout = {
  positions: Map<string, TLayoutRect>;
  /** Bounding box of every positioned node, in scene coordinates — used to compute a fit-to-view camera. */
  bounds: { left: number; top: number; right: number; bottom: number };
};

/**
 * The only file importing @dagrejs/dagre — pure layout math (node x/y), never rendering. Node
 * sizes must be measured from real rendered DOM first (variable-length labels), never estimated.
 */
export function runDagreLayout(model: TGraphModel, sizes: Map<string, { width: number; height: number }>): TGraphLayout {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: "TB", nodesep: 26, ranksep: 62, marginx: 20, marginy: 20 });
  graph.setDefaultEdgeLabel(() => ({}));

  for (const node of model.nodes) {
    const size = sizes.get(node.id) ?? { width: 170, height: 46 };
    graph.setNode(node.id, size);
  }
  for (const edge of model.edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      graph.setEdge(edge.source, edge.target);
    }
  }

  dagre.layout(graph);

  const positions = new Map<string, TLayoutRect>();
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const node of model.nodes) {
    const positioned = graph.node(node.id);
    if (!positioned) continue;
    const rect: TLayoutRect = {
      left: positioned.x - positioned.width / 2,
      top: positioned.y - positioned.height / 2,
      width: positioned.width,
      height: positioned.height,
    };
    positions.set(node.id, rect);
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }

  if (!Number.isFinite(left)) {
    left = 0;
    top = 0;
    right = 0;
    bottom = 0;
  }

  return { positions, bounds: { left, top, right, bottom } };
}
