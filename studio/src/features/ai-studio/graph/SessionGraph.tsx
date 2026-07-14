import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAiStudioStore } from "../state/ai-studio-store";
import { observationsForTurn } from "../observations-for-turn";
import { buildGraphModel, buildVisibleGraph, buildChildrenIndex, collectRootIds, countChildren, ancestorChain } from "./graph-model";
import { GraphTreeRow } from "./GraphTreeRow";
import { GraphToolbar } from "./GraphToolbar";
import { GraphDetailPopup } from "./GraphDetailPopup";
import type { TGraphNode } from "./graph-model";
import type { TAiObservation, TAiTurn } from "../../../api/ai-studio-api-types";

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

/**
 * Per-turn execution graph, rendered as a collapsible vertical tree (file-explorer style): every
 * branch starts collapsed, and clicking a node's card both opens its detail popup and reveals its
 * children indented one level below — never a whole-turn dagre canvas dumped on screen at once.
 * A turn with 70+ tool calls used to lay them all out side by side (dagre puts same-rank siblings
 * in a row); starting collapsed means only branches the user actually opens are ever mounted.
 */
export function SessionGraph({
  sessionId,
  turns,
  observations,
  focusTurnIndex,
  onFocusHandled,
}: {
  sessionId: string;
  turns: TAiTurn[];
  observations: TAiObservation[];
  /** Set by ConversationView's "Graph" button (via SessionWorkspace) to select a specific turn on arrival. */
  focusTurnIndex?: number;
  onFocusHandled?: () => void;
}): React.ReactElement {
  const { selectSession, toast } = useAiStudioStore();
  const defaultTurn = useMemo(() => [...turns].reverse().find((turn) => !turn.isContext) ?? turns[0], [turns]);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState<number | undefined>(focusTurnIndex ?? defaultTurn?.index);
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<{ node: TGraphNode; rect: DOMRect } | undefined>();

  const selectedTurn = turns.find((turn) => turn.index === selectedTurnIndex) ?? defaultTurn;

  const scopedObservations = useMemo(() => (selectedTurn ? observationsForTurn(observations, selectedTurn) : []), [observations, selectedTurn]);
  const fullModel = useMemo(() => buildGraphModel(scopedObservations), [scopedObservations]);
  const visibleModel = useMemo(() => buildVisibleGraph(fullModel, hiddenKinds), [fullModel, hiddenKinds]);
  const kinds = useMemo(() => [...new Set(fullModel.nodes.map((node) => node.kind))], [fullModel]);

  const nodesById = useMemo(() => new Map(visibleModel.nodes.map((node) => [node.id, node])), [visibleModel]);
  const childrenOf = useMemo(() => buildChildrenIndex(visibleModel), [visibleModel]);
  const childCounts = useMemo(() => countChildren(visibleModel), [visibleModel]);
  const rootIds = useMemo(() => collectRootIds(visibleModel), [visibleModel]);

  // A fresh turn is a fresh tree — start collapsed again rather than carrying over expand state
  // that may not even apply to the new turn's nodes.
  useEffect(() => {
    setExpandedIds(new Set());
  }, [selectedTurn?.id]);

  // The open popup can reference a node that a legend toggle or turn change just removed.
  useEffect(() => {
    setSelectedNode(undefined);
  }, [visibleModel]);

  useEffect(() => {
    if (focusTurnIndex === undefined) return;
    if (turns.some((turn) => turn.index === focusTurnIndex)) setSelectedTurnIndex(focusTurnIndex);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTurnIndex]);

  const matchIds = useMemo(() => {
    if (!search.trim()) return new Set<string>();
    return new Set(visibleModel.nodes.filter((node) => matchesSearch(node, search)).map((node) => node.id));
  }, [visibleModel, search]);

  // Search reaches into collapsed branches: auto-open every ancestor of a match without touching
  // `expandedIds` itself, so clearing the query restores exactly what the user had open by hand.
  const effectiveExpandedIds = useMemo(() => {
    if (matchIds.size === 0) return expandedIds;
    const next = new Set(expandedIds);
    for (const id of matchIds) {
      for (const ancestorId of ancestorChain(visibleModel, id)) next.add(ancestorId);
    }
    return next;
  }, [expandedIds, matchIds, visibleModel]);

  const dimIds = useMemo(() => {
    if (!search.trim()) return new Set<string>();
    return new Set(visibleModel.nodes.filter((node) => !matchIds.has(node.id)).map((node) => node.id));
  }, [visibleModel, matchIds, search]);

  const copy = (text: string, label: string): void => {
    navigator.clipboard.writeText(text);
    toast(`Copied ${label}`);
  };

  const toggleKind = (kind: string): void => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const toggleExpand = (nodeId: string): void => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  // Clicking a card is a one-way "drill in": it opens the detail popup and, if the node has
  // children, reveals them — it never re-collapses on a second click (that's what the chevron is
  // for), so reopening a popup you closed can't unexpectedly hide the tree underneath it.
  const openNode = (node: TGraphNode, event: React.MouseEvent): void => {
    setSelectedNode({ node, rect: event.currentTarget.getBoundingClientRect() });
    if ((childCounts.get(node.id) ?? 0) > 0 && !expandedIds.has(node.id)) {
      setExpandedIds((prev) => new Set(prev).add(node.id));
    }
  };

  const expandAll = (): void => setExpandedIds(new Set(visibleModel.nodes.map((node) => node.id)));
  const collapseAll = (): void => setExpandedIds(new Set());

  if (!turns.length || !selectedTurn) return <EmptyState>No turns recorded.</EmptyState>;

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
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />

      {!visibleModel.nodes.length ? (
        <EmptyState>No observations in this turn.</EmptyState>
      ) : (
        <div className="ai-graph-tree">
          {rootIds.map((rootId) => (
            <GraphTreeRow
              key={rootId}
              nodeId={rootId}
              depth={0}
              nodesById={nodesById}
              childrenOf={childrenOf}
              childCounts={childCounts}
              expandedIds={effectiveExpandedIds}
              dimIds={dimIds}
              onToggle={toggleExpand}
              onSelect={openNode}
            />
          ))}
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
