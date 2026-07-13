import { useEffect, useState } from "react";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAiStudioStore } from "../state/ai-studio-store";
import { SessionOverview } from "./SessionOverview";
import { TurnList } from "./TurnList";
import { SessionTimeline } from "./SessionTimeline";
import { SessionQuickActions } from "./SessionQuickActions";
import { SessionGraph } from "../graph/SessionGraph";
import type { TAiWorkspaceTabKind } from "../state/ai-studio-store";
import type { TAiObservation, TAiSession, TAiTurn, TSessionAdvisor, TSessionAnalysis } from "../../../api/ai-studio-api-types";

const TABS: Array<{ kind: TAiWorkspaceTabKind; label: string }> = [
  { kind: "overview", label: "Overview" },
  { kind: "turns", label: "Turns" },
  { kind: "graph", label: "Graph" },
  { kind: "timeline", label: "Timeline" },
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
        ) : activeTabKind === "turns" ? (
          <TurnList turns={turns} observations={observations} />
        ) : activeTabKind === "graph" ? (
          // Keyed on sessionId so switching sessions resets the internal turn-selection/camera state
          // instead of carrying over a turn index that may not exist in the new session's turns.
          <SessionGraph key={sessionId} sessionId={sessionId} turns={turns} observations={observations} />
        ) : (
          <SessionTimeline observations={observations} />
        )}
      </div>
    </div>
  );
}
