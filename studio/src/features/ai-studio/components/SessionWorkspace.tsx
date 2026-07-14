import { useEffect, useState } from "react";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAiStudioStore } from "../state/ai-studio-store";
import { SessionOverview } from "./SessionOverview";
import { SessionTimeline } from "./SessionTimeline";
import { SessionQuickActions } from "./SessionQuickActions";
import { ExecutionView } from "./ExecutionView";
import { FilesView } from "./FilesView";
import { CommandsView } from "./CommandsView";
import { ErrorsView } from "./ErrorsView";
import { VerificationView } from "./VerificationView";
import { RawView } from "./RawView";
import { SessionGraph } from "../graph/SessionGraph";
import { ConversationView } from "../conversation/ConversationView";
import type { TAiWorkspaceTabKind } from "../state/ai-studio-store";
import type { TAiObservation, TAiSession, TAiTurn, TSessionAdvisor, TSessionAnalysis } from "../../../api/ai-studio-api-types";

const TABS: Array<{ kind: TAiWorkspaceTabKind; label: string }> = [
  { kind: "overview", label: "Overview" },
  { kind: "conversation", label: "Conversation" },
  { kind: "execution", label: "Execution" },
  { kind: "timeline", label: "Timeline" },
  { kind: "graph", label: "Graph" },
  { kind: "files", label: "Files" },
  { kind: "commands", label: "Commands" },
  { kind: "errors", label: "Errors" },
  { kind: "verification", label: "Verification" },
  { kind: "raw", label: "Raw" },
];

export function SessionWorkspace({ sessionId }: { sessionId: string }): React.ReactElement {
  const { activeTabKind, setActiveTabKind, toast } = useAiStudioStore();
  const [session, setSession] = useState<TAiSession | undefined>();
  const [turns, setTurns] = useState<TAiTurn[]>([]);
  const [observations, setObservations] = useState<TAiObservation[]>([]);
  const [analysis, setAnalysis] = useState<TSessionAnalysis | undefined>();
  const [advisor, setAdvisor] = useState<TSessionAdvisor | undefined>();
  const [loading, setLoading] = useState(true);
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [focusTurnIndex, setFocusTurnIndex] = useState<number | undefined>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      aiStudioApi.getSession(sessionId),
      aiStudioApi.getTurns(sessionId, revealSecrets),
      aiStudioApi.getObservations(sessionId, { reveal: revealSecrets }),
      aiStudioApi.getAnalysis(sessionId),
      aiStudioApi.getAdvisor(sessionId),
    ])
      .then(([sessionResponse, turnsResponse, observationsResponse, analysisResponse, advisorResponse]) => {
        if (cancelled) return;
        setSession(sessionResponse.session);
        setTurns(turnsResponse.turns);
        setObservations(observationsResponse.observations);
        setAnalysis(analysisResponse);
        setAdvisor(advisorResponse);
      })
      .catch((error) => {
        if (!cancelled) toast(error instanceof Error ? error.message : String(error), "err");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, revealSecrets]);

  if (loading || !session || !analysis) {
    return (
      <div className="tabpane">
        <EmptyState>
          <span className="spin" /> loading session...
        </EmptyState>
      </div>
    );
  }

  const lastRealTurn = [...turns].reverse().find((turn) => !turn.isContext);

  /** Used by Files/Commands/Errors/Verification/Execution to jump into the Conversation tab at a turn. */
  const jumpToTurn = (turnIndex: number): void => {
    setActiveTabKind("conversation");
    setFocusTurnIndex(turnIndex);
  };

  return (
    <div className="tabpane">
      <div className="row" style={{ padding: "10px 10px 0" }}>
        <SessionQuickActions session={session} lastUserPrompt={lastRealTurn?.userRequest} />
      </div>
      <div className="tabbar-row">
        <div className="tabbar">
          {TABS.map((tab) => (
            <div key={tab.kind} className={`wtab${activeTabKind === tab.kind ? " active" : ""}`} onClick={() => setActiveTabKind(tab.kind)}>
              <span className="t-title">{tab.label}</span>
            </div>
          ))}
        </div>
        <label className="note" style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 10px", flex: "0 0 auto" }} title="Reveals raw text without secret redaction, for this browser tab only">
          <input type="checkbox" checked={revealSecrets} onChange={(event) => setRevealSecrets(event.target.checked)} />
          Show sensitive content
        </label>
      </div>
      <div className="pane-body">
        {activeTabKind === "overview" ? (
          <SessionOverview session={session} analysis={analysis} advisor={advisor} turns={turns} />
        ) : activeTabKind === "conversation" ? (
          <ConversationView session={session} turns={turns} observations={observations} focusTurnIndex={focusTurnIndex} onFocusHandled={() => setFocusTurnIndex(undefined)} />
        ) : activeTabKind === "execution" ? (
          <ExecutionView observations={observations} />
        ) : activeTabKind === "graph" ? (
          // Keyed on sessionId so switching sessions resets the internal turn-selection/camera state
          // instead of carrying over a turn index that may not exist in the new session's turns.
          <SessionGraph key={sessionId} sessionId={sessionId} turns={turns} observations={observations} />
        ) : activeTabKind === "files" ? (
          <FilesView fileImpact={analysis.fileImpact} onJumpToTurn={jumpToTurn} />
        ) : activeTabKind === "commands" ? (
          <CommandsView observations={observations} cwd={session.cwd} />
        ) : activeTabKind === "errors" ? (
          <ErrorsView errorGroups={analysis.errorGroups} observations={observations} onJumpToTurn={jumpToTurn} />
        ) : activeTabKind === "verification" ? (
          <VerificationView verification={analysis.verification} observations={observations} />
        ) : activeTabKind === "raw" ? (
          <RawView observations={observations} />
        ) : (
          <SessionTimeline observations={observations} />
        )}
      </div>
    </div>
  );
}
