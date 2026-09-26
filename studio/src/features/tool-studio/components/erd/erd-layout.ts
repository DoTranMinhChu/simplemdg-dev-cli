import type { TErdEdge, TErdEntity, TErdField } from "./erd-types";

/**
 * Pure layout helpers for the ERD canvas (no React Flow import, so editors can use `buildErdTree`
 * for inspector hints without pulling the canvas chunk).
 *
 * Why a custom layout instead of dagre: a real MDG model is a wide, shallow composition tree (e.g.
 * BusinessPartner: 1 → 21 → 37 → 24 entities) where every child also has an association straight
 * back to its parent. A rank-based layout puts each depth level in ONE column — 37 nodes stacked
 * ≈ 9,500px tall, unreadable at any zoom that fits. Here the tree is taken from a BFS spanning
 * tree (so back-links don't distort ranking) and each node's children subtrees are packed into as
 * many columns as it takes to keep the block roughly screen-shaped.
 */

export const ERD_NODE_WIDTH = 250;
const HEADER_HEIGHT = 44;
const ROW_HEIGHT = 22;
const FOOTER_HEIGHT = 22;
/** Rows shown per node before "+N more fields" — keys always shown, even past this. */
const MAX_ROWS = 8;

const RANK_GAP = 90;
const COLUMN_GAP = 48;
const ROW_GAP = 22;
/** Target width:height ratio of a packed block — roughly the canvas viewport's shape. */
const TARGET_RATIO = 1.6;

export function erdVisibleRows(entity: TErdEntity, keysOnly: boolean): { rows: TErdField[]; hiddenCount: number } {
  const keys = entity.fields.filter((field) => field.isKey);
  if (keysOnly) return { rows: keys, hiddenCount: entity.fields.length - keys.length };
  const rows = [...keys, ...entity.fields.filter((field) => !field.isKey)].slice(0, Math.max(MAX_ROWS, keys.length));
  return { rows, hiddenCount: entity.fields.length - rows.length };
}

export function erdNodeHeight(entity: TErdEntity, keysOnly: boolean): number {
  const { rows, hiddenCount } = erdVisibleRows(entity, keysOnly);
  return HEADER_HEIGHT + rows.length * ROW_HEIGHT + (hiddenCount > 0 ? FOOTER_HEIGHT : 0) + 8;
}

export type TErdTree = {
  roots: string[];
  parentOf: Map<string, string>;
  childrenOf: Map<string, string[]>;
  /** Edges pointing from a node back up to one of its own ancestors (e.g. `AdditionalCustomer.to_BusinessPartner`). */
  backLinkEdgeIds: Set<string>;
};

/**
 * BFS spanning tree over the edges, starting from `rootId` when given, then from nodes nothing
 * points at, then anything still unvisited (so every node lands in exactly one tree).
 */
export function buildErdTree(entities: TErdEntity[], edges: TErdEdge[], rootId?: string): TErdTree {
  const ids = entities.map((entity) => entity.id);
  const idSet = new Set(ids);
  const outgoing = new Map<string, TErdEdge[]>();
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target) || edge.source === edge.target) continue;
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
    hasIncoming.add(edge.target);
  }

  const starts = [
    ...(rootId && idSet.has(rootId) ? [rootId] : []),
    ...ids.filter((id) => id !== rootId && !hasIncoming.has(id)),
    ...ids.filter((id) => id !== rootId && hasIncoming.has(id)),
  ];

  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  const visited = new Set<string>();
  const roots: string[] = [];
  for (const start of starts) {
    if (visited.has(start)) continue;
    roots.push(start);
    visited.add(start);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const edge of outgoing.get(id) ?? []) {
        if (visited.has(edge.target)) continue;
        visited.add(edge.target);
        parentOf.set(edge.target, id);
        childrenOf.set(id, [...(childrenOf.get(id) ?? []), edge.target]);
        queue.push(edge.target);
      }
    }
  }

  const isAncestor = (ancestor: string, of: string): boolean => {
    for (let current = parentOf.get(of); current; current = parentOf.get(current)) if (current === ancestor) return true;
    return false;
  };
  const backLinkEdgeIds = new Set(edges.filter((edge) => idSet.has(edge.source) && idSet.has(edge.target) && (edge.source === edge.target || isAncestor(edge.target, edge.source))).map((edge) => edge.id));

  return { roots, parentOf, childrenOf, backLinkEdgeIds };
}

type TBox = { width: number; height: number; items: Array<{ id: string; x: number; y: number }> };

/**
 * Packs boxes into columns (keeping their order), picking the column height whose resulting block
 * is closest to screen-shaped — subtrees are often much wider than tall, so a fixed "square" guess
 * produces a long thin strip.
 */
function packColumns(boxes: TBox[], minHeight: number): TBox {
  const tallest = Math.max(...boxes.map((box) => box.height));
  const total = boxes.reduce((sum, box) => sum + box.height + ROW_GAP, 0);
  const floor = Math.max(minHeight, tallest);
  let best: TBox | undefined;
  let bestScore = Infinity;
  const steps = 24;
  for (let step = 0; step <= steps; step += 1) {
    const targetHeight = floor + ((Math.max(total, floor) - floor) * step) / steps;
    const packed = packColumnsAt(boxes, targetHeight);
    const score = Math.abs(Math.log(packed.width / Math.max(packed.height, 1)) - Math.log(TARGET_RATIO));
    if (score < bestScore) {
      bestScore = score;
      best = packed;
    }
  }
  return best ?? packColumnsAt(boxes, floor);
}

function packColumnsAt(boxes: TBox[], targetHeight: number): TBox {
  const items: TBox["items"] = [];
  let columnX = 0;
  let columnY = 0;
  let columnWidth = 0;
  let blockHeight = 0;
  for (const box of boxes) {
    if (columnY > 0 && columnY + box.height > targetHeight) {
      columnX += columnWidth + COLUMN_GAP;
      columnY = 0;
      columnWidth = 0;
    }
    for (const item of box.items) items.push({ id: item.id, x: columnX + item.x, y: columnY + item.y });
    columnY += box.height + ROW_GAP;
    columnWidth = Math.max(columnWidth, box.width);
    blockHeight = Math.max(blockHeight, columnY - ROW_GAP);
  }
  return { width: columnX + columnWidth, height: blockHeight, items };
}

/** Top-left positions for every entity: each root's subtree laid out left→right, root trees packed like siblings. */
export function computeErdLayout(entities: TErdEntity[], tree: TErdTree, keysOnly: boolean): Map<string, { x: number; y: number }> {
  const heights = new Map(entities.map((entity) => [entity.id, erdNodeHeight(entity, keysOnly)]));

  const place = (id: string): TBox => {
    const height = heights.get(id) ?? HEADER_HEIGHT;
    const children = tree.childrenOf.get(id) ?? [];
    if (!children.length) return { width: ERD_NODE_WIDTH, height, items: [{ id, x: 0, y: 0 }] };
    const block = packColumns(children.map(place), height);
    const offsetX = ERD_NODE_WIDTH + RANK_GAP;
    return {
      width: offsetX + block.width,
      height: Math.max(height, block.height),
      items: [{ id, x: 0, y: 0 }, ...block.items.map((item) => ({ id: item.id, x: offsetX + item.x, y: item.y }))],
    };
  };

  const forest = tree.roots.length ? packColumns(tree.roots.map(place), 0) : { width: 0, height: 0, items: [] };
  return new Map(forest.items.map((item) => [item.id, { x: item.x, y: item.y }]));
}
