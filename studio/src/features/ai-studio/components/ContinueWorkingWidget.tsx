import { useEffect, useState } from "react";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { useAiStudioStore } from "../state/ai-studio-store";
import { useSessionResume } from "../use-session-resume";
import { LaunchConfirmModal } from "./LaunchConfirmModal";
import { SessionRow } from "./SessionRow";
import { ProviderChip } from "./ProviderChip";
import type { TAiSession } from "../../../api/ai-studio-api-types";

function formatRelativeTime(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return "";
  const diffMs = Date.now() - time;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** Recent + pinned sessions with a one-click Resume, shown on AI Studio's welcome screen so returning to old work never requires the sidebar search. */
export function ContinueWorkingWidget(): React.ReactElement | null {
  const { selectSession, toast } = useAiStudioStore();
  const { pending, requestLaunch, confirmPending, cancelPending } = useSessionResume(toast);
  const [pinned, setPinned] = useState<TAiSession[]>([]);
  const [recent, setRecent] = useState<TAiSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([aiStudioApi.listSessions({ pinnedOnly: true }, undefined, 5), aiStudioApi.listSessions({}, undefined, 6)])
      .then(([pinnedResponse, recentResponse]) => {
        if (cancelled) return;
        setPinned(pinnedResponse.sessions);
        setRecent(recentResponse.sessions.filter((session) => !session.pinned).slice(0, 5));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || (!pinned.length && !recent.length)) return null;

  const renderRow = (session: TAiSession): React.ReactElement => (
    <SessionRow
      key={session.id}
      session={session}
      variant="compact"
      onClick={() => selectSession(session.id)}
      onResume={(event) => {
        event.stopPropagation();
        requestLaunch(session, "resume");
      }}
      meta={
        <>
          <ProviderChip provider={session.provider} /> {session.project}
          {session.gitBranch ? ` · ${session.gitBranch}` : ""} · {formatRelativeTime(session.endedAt || session.startedAt)}
        </>
      }
    />
  );

  return (
    <div className="wlist" style={{ textAlign: "left", maxWidth: 640, margin: "20px auto 0" }}>
      {pinned.length ? (
        <>
          <h4 style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px" }}>Pinned</h4>
          {pinned.map(renderRow)}
        </>
      ) : null}
      {recent.length ? (
        <>
          <h4 style={{ color: "var(--muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".6px", marginTop: pinned.length ? 14 : 0 }}>Continue working</h4>
          {recent.map(renderRow)}
        </>
      ) : null}
      {pending ? <LaunchConfirmModal title={pending.title} launch={pending.launch} onCancel={cancelPending} onConfirm={confirmPending} /> : null}
    </div>
  );
}
