import type { TAiObservation, TAiObservationType } from "../../../api/ai-studio-api-types";

export type TGraphNode = {
  id: string;
  kind: TAiObservationType | string;
  label: string;
  meta: string;
  isError: boolean;
  observation: TAiObservation;
};

export type TGraphEdge = {
  id: string;
  source: string;
  target: string;
  /** True when the edge leads into a subagent-delegation node — dashed in the rendered graph. */
  delegation: boolean;
};

export type TGraphModel = {
  nodes: TGraphNode[];
  edges: TGraphEdge[];
};

function clip(text: string, length: number): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length > length ? `${single.slice(0, length)}…` : single;
}

function formatDuration(ms: number): string {
  if (!ms) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

/**
 * User/assistant/reasoning observations carry a useless literal `name` (e.g. "assistant",
 * "thinking") — their real content lives in input/output. Every other kind's `name` is the
 * meaningful label (tool name, subagent type, skill name, slash-command name).
 */
function deriveLabel(observation: TAiObservation): string {
  if (observation.type === "user" || observation.type === "assistant" || observation.type === "reasoning") {
    return clip(observation.input || observation.output || observation.name, 80);
  }
  return observation.name || observation.type;
}

function deriveMeta(observation: TAiObservation): string {
  const parts: string[] = [];
  if (observation.durationMs) parts.push(formatDuration(observation.durationMs));
  if (observation.tokens) parts.push(`${observation.tokens} tok`);
  return parts.join(" · ");
}

/** Builds one node per observation and one edge per parentId link that resolves within the set — no synthetic node-splitting, since TAiObservationType already maps 1:1 to a visual "kind". */
export function buildGraphModel(observations: TAiObservation[]): TGraphModel {
  const byId = new Map(observations.map((observation) => [observation.id, observation]));

  const nodes: TGraphNode[] = observations.map((observation) => ({
    id: observation.id,
    kind: observation.type,
    label: deriveLabel(observation),
    meta: deriveMeta(observation),
    isError: observation.isError,
    observation,
  }));

  const edges: TGraphEdge[] = [];
  for (const observation of observations) {
    if (observation.parentId && byId.has(observation.parentId)) {
      edges.push({
        id: `${observation.parentId}->${observation.id}`,
        source: observation.parentId,
        target: observation.id,
        delegation: observation.type === "subagent",
      });
    }
  }

  return { nodes, edges };
}

/**
 * Filters out hidden-kind nodes and reconnects their children to the nearest still-visible
 * ancestor, so toggling a legend chip never leaves orphaned floating nodes. The per-turn tree is
 * shallow (every non-root observation's parent is the nearest preceding assistant/root — see
 * claude-session-provider.ts), so this reparent walk is at most 1-2 hops in practice.
 */
export function buildVisibleGraph(model: TGraphModel, hiddenKinds: ReadonlySet<string>): TGraphModel {
  if (hiddenKinds.size === 0) return model;

  const parentOf = new Map(model.edges.map((edge) => [edge.target, edge.source]));
  const delegationInto = new Set(model.edges.filter((edge) => edge.delegation).map((edge) => edge.target));

  const nearestVisibleAncestor = (nodeId: string): string | undefined => {
    let current = parentOf.get(nodeId);
    const guard = new Set<string>();
    while (current && !guard.has(current)) {
      guard.add(current);
      const node = model.nodes.find((candidate) => candidate.id === current);
      if (node && !hiddenKinds.has(node.kind)) return current;
      current = parentOf.get(current);
    }
    return undefined;
  };

  const nodes = model.nodes.filter((node) => !hiddenKinds.has(node.kind));
  const visibleIds = new Set(nodes.map((node) => node.id));

  const edges: TGraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    if (visibleIds.has(node.id) && parentOf.has(node.id)) {
      const directParent = parentOf.get(node.id) as string;
      const source = visibleIds.has(directParent) ? directParent : nearestVisibleAncestor(node.id);
      if (source && source !== node.id) {
        const key = `${source}->${node.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          edges.push({ id: key, source, target: node.id, delegation: delegationInto.has(node.id) });
        }
      }
    }
  }

  return { nodes, edges };
}
