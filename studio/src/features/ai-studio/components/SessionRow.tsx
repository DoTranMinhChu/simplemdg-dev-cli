import { forwardRef } from "react";
import { Icon } from "../../../components/common/Icon";
import { IconButton } from "../../../components/common/IconButton";
import { contextSeverity, formatDuration, formatTokens, shortModelLabel, shortSessionId } from "../format";
import type { TAiSession } from "../../../api/ai-studio-api-types";

const RECENT_WINDOW_MS = 5 * 60 * 1000;

function outcomeLabel(outcome: string): string {
  return outcome.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function providerLabel(provider: string): string {
  if (provider === "claude") return "Claude Code";
  if (provider === "codex") return "Codex";
  return provider;
}

function isRecent(session: TAiSession): boolean {
  const endedAtMs = Date.parse(session.endedAt);
  return Number.isFinite(endedAtMs) && Date.now() - endedAtMs < RECENT_WINDOW_MS;
}

type TSessionRowProps = {
  session: TAiSession;
  active?: boolean;
  onClick: () => void;
  onResume: (event: React.MouseEvent) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  /** Compact-variant-only secondary line; ignored by the "card" variant, which derives its own stats from `session`. */
  meta?: React.ReactNode;
  /** "card" (default): the richer ClaudeVisual-style layout — context meter + stat grid, used by the sidebar list.
   *  "compact": today's single ellipsis line — used by ContinueWorkingWidget, where a short scannable list matters more than density of stats. */
  variant?: "card" | "compact";
  /** Card-variant-only: renders the expand/collapse chevron for a session with sub-agents. Omit (or pass no onToggleExpand) to hide it, e.g. for a nested child row that shouldn't expand further. */
  expanded?: boolean;
  onToggleExpand?: (event: React.MouseEvent) => void;
  /** Card-variant-only: true for a sub-agent row rendered nested under its parent — adds an indent + "sub-agent" chip instead of the expand chevron, so it reads as a child, never as a sibling top-level session. */
  nested?: boolean;
};

/** Full untruncated hover tooltip: the raw title plus enough surrounding context (project, provider,
 *  path) to identify the session at a glance, since the on-card title is CSS-ellipsised. */
function fullTooltip(session: TAiSession): string {
  const lines = [session.title || session.id, `Project: ${session.project || "unknown"}`, session.cwd, `ID: ${session.id}`];
  return lines.filter(Boolean).join("\n");
}

/**
 * Shared session row used by both the sidebar list and the "Continue working" widget. The two
 * variants intentionally render different markup (see `variant` above) rather than trying to
 * force one layout to serve both — the compact variant's shape must stay pixel-identical to
 * before this redesign.
 */
export const SessionRow = forwardRef<HTMLDivElement, TSessionRowProps>(function SessionRow(
  { session, active = false, onClick, onResume, onContextMenu, meta, variant = "card", expanded = false, onToggleExpand, nested = false },
  ref,
) {
  if (variant === "compact") {
    return (
      <div ref={ref} className={`ai-session-row${active ? " active" : ""}`} onClick={onClick} onContextMenu={onContextMenu} title={fullTooltip(session)}>
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
  }

  const usedTokens = session.inputTokens + session.outputTokens;
  // The context meter reads the most recent turn's snapshot, not the lifetime `usedTokens` total
  // above (which only grows and would show >100% on any long-running healthy session).
  const contextTokens = session.liveContextTokens;
  const contextPercent = session.contextWindowTokens > 0 ? (contextTokens / session.contextWindowTokens) * 100 : 0;
  const severity = contextSeverity(contextPercent);
  const recent = isRecent(session);

  const expandable = Boolean(onToggleExpand) && !nested;

  return (
    <div
      ref={ref}
      className={`ai-session-card${active ? " active" : ""}${nested ? " nested" : ""}`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={fullTooltip(session)}
    >
      <div className="ai-scard-top">
        {expandable ? (
          <button
            type="button"
            className="ai-scard-expand-toggle"
            onClick={(event) => {
              event.stopPropagation();
              onToggleExpand?.(event);
            }}
            aria-label={expanded ? "Collapse sub-agents" : "Expand sub-agents"}
            aria-expanded={expanded}
            title={`${session.subAgentCount} sub-agent session${session.subAgentCount === 1 ? "" : "s"}`}
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : null}
        <span className={`ai-row-status ${session.outcome}`} title={`Outcome: ${outcomeLabel(session.outcome)}`} />
        <span className="ai-scard-title">
          {session.pinned ? <Icon name="pin" className="ai-row-pin" /> : null}
          <span className="ai-scard-title-text">{session.title || session.id}</span>
        </span>
        {nested ? <span className="ai-chip sub-agent">sub-agent</span> : null}
        {recent ? <span className="ai-scard-recent" title="Recently active (within the last 5 minutes)" /> : null}
        <span className="ai-chip model" title={session.model || "unknown model"}>
          {shortModelLabel(session.model)}
        </span>
        <span className="ai-scard-actions">
          <IconButton icon="play" label="Resume in Claude Code" onClick={onResume} />
        </span>
      </div>
      <div className="ai-scard-subtitle">
        {providerLabel(session.provider)} · {session.project || "unknown project"}
        {session.gitBranch ? ` · ${session.gitBranch}` : ""} · {shortSessionId(session.id)}
        {session.errorCount > 0 ? (
          <span className="ai-row-error"> · {session.errorCount} error{session.errorCount === 1 ? "" : "s"}</span>
        ) : null}
      </div>
      <div className="ai-scard-meter" title={`${formatTokens(contextTokens)} / ${formatTokens(session.contextWindowTokens)} tokens (~${Math.round(contextPercent)}%) as of the last turn`}>
        <div className="ai-scard-meter-row">
          <span className="ai-scard-meter-label">Context</span>
          <span className="ai-scard-meter-value">
            {formatTokens(contextTokens)} / {formatTokens(session.contextWindowTokens)} <b className={severity}>~{Math.round(contextPercent)}%</b>
          </span>
        </div>
        <div className="ai-scard-meter-track">
          <div className={`ai-scard-meter-fill ${severity}`} style={{ width: `${Math.min(100, contextPercent)}%` }} />
        </div>
      </div>
      <div className="ai-scard-stats">
        <div className="ai-scard-stat">
          <b>{formatTokens(usedTokens)}</b>
          <u>tokens</u>
        </div>
        <div className="ai-scard-stat">
          <b>{session.subAgentCount}</b>
          <u>agents</u>
        </div>
        <div className="ai-scard-stat">
          <b>{session.toolCallCount}</b>
          <u>tool calls</u>
        </div>
        <div className="ai-scard-stat">
          <b>{formatDuration(session.durationMs)}</b>
          <u>duration</u>
        </div>
      </div>
    </div>
  );
});
