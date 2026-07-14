import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../../../components/common/Button";
import { Modal } from "../../../components/common/Modal";
import { observationTypeIcon } from "../observation-icon";
import type { TGraphNode } from "./graph-model";

function kindLabel(kind: string): string {
  return kind.replace(/-/g, " ");
}

function formatDuration(ms: number): string {
  if (!ms) return "";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function subagentIdFrom(metadata: string): string | undefined {
  try {
    const parsed = JSON.parse(metadata || "{}") as { agentId?: string };
    return parsed.agentId;
  } catch {
    return undefined;
  }
}

/** `claude:<uuid>` or `claude:<uuid>:agent:<parentAgentId>` → the subagent transcript's own session id. */
function subagentSessionId(parentSessionId: string, agentId: string): string {
  const rawSessionId = parentSessionId.split(":")[1] ?? parentSessionId;
  return `claude:${rawSessionId}:agent:${agentId}`;
}

/**
 * Floating detail popup glued near the clicked node — mirrors ProjectPicker.tsx's
 * portal/viewport-clamp/outside-click-close pattern rather than the app-wide Modal, since a
 * backdrop-dimmed modal would block re-panning/clicking another node while inspecting one.
 */
export function GraphDetailPopup({
  node,
  anchorRect,
  sessionId,
  onClose,
  onCopy,
  onViewSubagentSession,
}: {
  node: TGraphNode;
  anchorRect: DOMRect;
  sessionId: string;
  onClose: () => void;
  onCopy: (text: string, label: string) => void;
  onViewSubagentSession: (sessionId: string) => void;
}): React.ReactElement | null {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: Math.max(8, Math.min(anchorRect.right + 10, window.innerWidth - 8)), top: anchorRect.top });
  // Long tool input/output can run to thousands of characters — the anchored popover is
  // deliberately small (it has to fit next to the clicked node without covering the canvas), so
  // this reuses the app-wide Modal for a comfortably large, centered view of the same content.
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const width = popover?.offsetWidth ?? 320;
    const height = popover?.offsetHeight ?? 260;
    const preferRight = anchorRect.right + 10 + width <= window.innerWidth - 8;
    const rawLeft = preferRight ? anchorRect.right + 10 : anchorRect.left - 10 - width;
    const left = Math.min(Math.max(8, rawLeft), Math.max(8, window.innerWidth - width - 8));
    const top = Math.min(Math.max(8, anchorRect.top), window.innerHeight - height - 8);
    setPosition({ left, top });
  }, [anchorRect]);

  useEffect(() => {
    // Expanded mode renders inside the app-wide Modal, which owns its own backdrop-click and
    // Escape handling — these outside-click/scroll auto-close listeners are only for the anchored
    // popover, and attaching them here too would close the modal the instant anything inside it
    // is clicked or scrolled (its content isn't inside popoverRef, which only exists in the
    // popover branch, so it would always look like an "outside" click/scroll).
    if (expanded) return;

    const onDocumentClick = (): void => onClose();
    // The popover's own body scrolls (long input/output — see the overflow-y:auto on
    // .ai-graph-detail), and that scroll event is still visible to this capture-phase listener as
    // it passes through `document` on its way to the target. Without the containment check, the
    // very first scroll tick inside the popover closed it instantly. Only a scroll *outside* the
    // popover (e.g. panning the graph canvas behind it) should close it.
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("click", onDocumentClick);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onDocumentClick);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, expanded]);

  const overlayRoot = document.getElementById("overlay-root");
  if (!overlayRoot) return null;

  const observation = node.observation;
  const agentId = node.kind === "subagent" ? subagentIdFrom(observation.metadata) : undefined;

  const body = (
    <>
      <div className="ai-graph-detail-head">
        <span className="ai-graph-node-glyph">{observationTypeIcon(node.kind)}</span>
        <span className="ai-graph-detail-kind">{kindLabel(node.kind)}</span>
        {node.isError ? <span className="ai-graph-detail-error">Error</span> : null}
        <span className="grow" />
        {!expanded ? (
          <button type="button" className="ai-graph-detail-expand" onClick={() => setExpanded(true)} aria-label="Expand" title="Open in a larger view">
            ⤢
          </button>
        ) : null}
        <button type="button" className="ai-graph-detail-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="ai-graph-detail-label">{node.label}</div>
      {node.meta ? <div className="note">{node.meta}</div> : null}

      {agentId ? (
        <Button size="sm" variant="ghost" style={{ marginTop: 8 }} onClick={() => onViewSubagentSession(subagentSessionId(sessionId, agentId))}>
          View subagent session
        </Button>
      ) : null}

      {observation.input ? (
        <div className="ai-graph-detail-section">
          <div className="ai-graph-detail-section-head">
            <span>Input</span>
            <Button size="sm" variant="ghost" onClick={() => onCopy(observation.input, "input")}>
              Copy
            </Button>
          </div>
          <pre className="cell-pre wrap">{observation.input}</pre>
        </div>
      ) : null}

      {observation.output ? (
        <div className="ai-graph-detail-section">
          <div className="ai-graph-detail-section-head">
            <span>Output</span>
            <Button size="sm" variant="ghost" onClick={() => onCopy(observation.output, "output")}>
              Copy
            </Button>
          </div>
          <pre className="cell-pre wrap">{observation.output}</pre>
        </div>
      ) : null}

      <div className="note" style={{ marginTop: 8 }}>
        {observation.durationMs ? `${formatDuration(observation.durationMs)} · ` : ""}
        {observation.tokens ? `${observation.tokens} token · ` : ""}
        Observation <code>{observation.id.slice(0, 8)}</code>
      </div>
    </>
  );

  if (expanded) {
    return (
      <Modal onClose={onClose} width={720}>
        <div className="ai-graph-detail ai-graph-detail-expanded">{body}</div>
      </Modal>
    );
  }

  return createPortal(
    <div ref={popoverRef} className="ai-graph-detail" style={{ position: "fixed", left: position.left, top: position.top }} onClick={(event) => event.stopPropagation()}>
      {body}
    </div>,
    overlayRoot,
  );
}
