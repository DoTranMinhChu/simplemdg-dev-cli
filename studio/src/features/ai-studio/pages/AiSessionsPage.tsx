import { EmptyState } from "../../../components/common/EmptyState";
import { SessionNavigator } from "../components/SessionNavigator";
import { SessionWorkspace } from "../components/SessionWorkspace";
import { useAiStudioStore } from "../state/ai-studio-store";

/**
 * The session browser: sidebar list + selected-session workspace — what AI Studio used to be as
 * its only screen. Below 768px, `.ai-sessions-layout`'s CSS shows the list OR the workspace, never
 * both (see globals.css) — the "Back to sessions" button below is how you get back to the list on
 * that layout; it's hidden by default and only shown by that same mobile CSS.
 *
 * `.ai-session-detail-area` gives SessionWorkspace's `.tabpane` (position:absolute; inset:0) a
 * closer positioned ancestor than `.workspace` — without it, `.tabpane` fills the whole `.workspace`
 * and visually covers the back button, which sits above it in `.ai-session-detail-shell`.
 */
export function AiSessionsPage(): React.ReactElement {
  const { selectedSessionId, selectSession } = useAiStudioStore();

  return (
    <div className={`main-layout ai-sessions-layout${selectedSessionId ? " has-selection" : ""}`}>
      <aside className="sidebar">
        <SessionNavigator />
      </aside>
      <div className="workspace">
        {selectedSessionId ? (
          <div className="ai-session-detail-shell">
            <div className="ai-mobile-back-bar">
              <button type="button" className="ai-mobile-back" onClick={() => selectSession(undefined)}>
                ← Sessions
              </button>
            </div>
            <div className="ai-session-detail-area">
              <SessionWorkspace sessionId={selectedSessionId} />
            </div>
          </div>
        ) : (
          <div className="welcome">
            <h1>Sessions</h1>
            <div className="lede">Select a session on the left to inspect it.</div>
            <EmptyState>Pick a session from the sidebar, or click Refresh if you don't see recent activity yet.</EmptyState>
          </div>
        )}
      </div>
    </div>
  );
}
