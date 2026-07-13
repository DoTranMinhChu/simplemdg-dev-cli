import { forwardRef } from "react";
import { Icon } from "../../../components/common/Icon";
import { IconButton } from "../../../components/common/IconButton";
import type { TAiSession } from "../../../api/ai-studio-api-types";

function outcomeLabel(outcome: string): string {
  return outcome.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Shared, grid-aligned session row used by both the sidebar list and the "Continue working"
 * widget — single-line ellipsis title, an outcome dot readable without opening the session, and a
 * hover-revealed resume action. Callers supply their own `meta` line content (the sidebar shows
 * duration/tokens/tools, the widget shows a relative "last active" time) so the two views can stay
 * visually consistent without needing identical data. Forwards a ref so the sidebar's virtual list
 * can measure one real rendered row's height.
 */
export const SessionRow = forwardRef<
  HTMLDivElement,
  {
    session: TAiSession;
    active?: boolean;
    onClick: () => void;
    onResume: (event: React.MouseEvent) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    meta: React.ReactNode;
  }
>(function SessionRow({ session, active = false, onClick, onResume, onContextMenu, meta }, ref) {
  return (
    <div ref={ref} className={`ai-session-row${active ? " active" : ""}`} onClick={onClick} onContextMenu={onContextMenu} title={session.title || session.id}>
      <span className={`ai-row-status ${session.outcome}`} title={`Outcome: ${outcomeLabel(session.outcome)}`} />
      <span className="ai-row-title">
        {session.pinned ? <Icon name="pin" className="ai-row-pin" /> : null}
        <span className="ai-row-title-text">{session.title || session.id}</span>
      </span>
      <span className="ai-row-meta">{meta}</span>
      <span className="ai-row-actions">
        <IconButton icon="play" label="Resume in Claude Code" onClick={onResume} />
      </span>
    </div>
  );
});
