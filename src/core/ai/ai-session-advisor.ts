import type { TAdvisorDimension, TAdvisorRecommendation, TAiObservation, TAiSession, TSessionAdvisor, TSessionAgent } from "./ai-types";

// Heuristic efficiency scoring for a session, inspired by (but simpler than) similar advisors
// shipped by other Claude Code observability tools. Every number here is a best-effort estimate
// derived from token counts and tool-call shapes already observed elsewhere in this file's
// sibling modules — never an LLM inference, and never billing data (see ai-model-context-windows.ts).

/** Below this many total tokens a session hasn't done enough to score meaningfully — scoring it
 *  would just add noise (a fresh session and a "bad" session both start at 0). */
const NEUTRAL_TOKEN_THRESHOLD = 2000;

/** A child session whose last observed activity is within this window is treated as still
 *  running. Approximate: this is an ingestion-based architecture (watch-and-reingest), not a
 *  live push, so there's no true "is this process still alive" signal to read. */
const LIVE_WINDOW_MS = 2 * 60 * 1000;

const RECOMMENDATION_THRESHOLD = 70;
const CRITICAL_THRESHOLD = 40;

function scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  if (score >= 40) return "D";
  return "F";
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function clip(value: string, length: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > length ? `${single.slice(0, length)}…` : single;
}

// --- Per-dimension scoring (0-100). Each is independently computable from a single TAiSession
// row except orchestration, which needs the joined sub-agent list. ------------------------------

function contextHealthScore(session: Pick<TAiSession, "inputTokens" | "outputTokens" | "contextWindowTokens">): number {
  const used = session.inputTokens + session.outputTokens;
  const percent = session.contextWindowTokens > 0 ? (used / session.contextWindowTokens) * 100 : 0;
  if (percent <= 50) return 100;
  if (percent <= 90) return 100 - (percent - 50) * 1.5;
  return Math.max(0, 40 - (percent - 90) * 4);
}

function cacheEfficiencyScore(session: Pick<TAiSession, "cacheReadTokens" | "cacheCreationTokens">): number {
  const total = session.cacheReadTokens + session.cacheCreationTokens;
  if (total < 1000) return 100; // too little cache signal to penalize
  return (session.cacheReadTokens / total) * 100;
}

function modelFitScore(session: Pick<TAiSession, "model" | "inputTokens" | "outputTokens" | "toolCallCount">): number {
  if (!session.model.toLowerCase().includes("opus")) return 100; // only premium models are checked
  const total = session.inputTokens + session.outputTokens;
  const outputShare = total > 0 ? session.outputTokens / total : 0;
  return outputShare < 0.15 && session.toolCallCount > 5 ? 40 : 100;
}

type TDominantAgent = TSessionAgent & { share: number };

function orchestrationScore(sessionTokens: number, agents: TSessionAgent[]): { score: number; dominant?: TDominantAgent } {
  if (!agents.length) return { score: 100 };
  const grandTotal = sessionTokens + agents.reduce((sum, agent) => sum + agent.tokens, 0);
  if (grandTotal === 0) return { score: 100 };
  const dominant = agents.reduce((max, agent) => (agent.tokens > max.tokens ? agent : max));
  const share = dominant.tokens / grandTotal;
  if (share <= 0.5) return { score: 100 };
  // Dominant AND narrow (few tool calls for the tokens spent) reads as a bad orchestration
  // choice — a direct Grep/Read would likely have been cheaper than spawning an agent.
  return dominant.toolCallCount < 5 ? { score: 35, dominant: { ...dominant, share } } : { score: 65, dominant: { ...dominant, share } };
}

// --- Sub-agent join: the parent's "subagent" tool-call observations carry the agent's type
// (e.g. "code-reviewer") and spawn prompt; the agentId set on that observation's metadata once
// the tool_result resolves is the only thing linking it to the child session's own id
// (`<parent>:agent:<agentId>`). Same convention GraphDetailPopup.tsx uses client-side for the
// per-turn graph's "View subagent session" jump. ------------------------------------------------

function parseAgentId(metadata: string): string | undefined {
  try {
    const parsed = JSON.parse(metadata || "{}") as { agentId?: string };
    return parsed.agentId;
  } catch {
    return undefined;
  }
}

function agentIdFromSessionId(id: string): string | undefined {
  return id.match(/:agent:([^:]+)$/)?.[1];
}

function extractSpawnReason(rawInput: string): string | undefined {
  try {
    const parsed = JSON.parse(rawInput) as Record<string, unknown>;
    const text = typeof parsed.description === "string" ? parsed.description : typeof parsed.prompt === "string" ? parsed.prompt : "";
    return text ? clip(text, 140) : undefined;
  } catch {
    return undefined;
  }
}

function subagentInfoByAgentId(parentObservations: TAiObservation[]): Map<string, { type: string; spawnReason?: string }> {
  const map = new Map<string, { type: string; spawnReason?: string }>();
  for (const observation of parentObservations) {
    if (observation.type !== "subagent") continue;
    const agentId = parseAgentId(observation.metadata);
    if (!agentId) continue;
    map.set(agentId, { type: observation.name || "subagent", spawnReason: extractSpawnReason(observation.input) });
  }
  return map;
}

function buildAgents(children: TAiSession[], parentObservations: TAiObservation[]): TSessionAgent[] {
  const infoByAgentId = subagentInfoByAgentId(parentObservations);
  const now = Date.now();
  return children.map((child) => {
    const agentId = agentIdFromSessionId(child.id) ?? "";
    const info = infoByAgentId.get(agentId);
    const endedAtMs = Date.parse(child.endedAt);
    const status: TSessionAgent["status"] = Number.isFinite(endedAtMs) && now - endedAtMs < LIVE_WINDOW_MS ? "running" : "done";
    return {
      sessionId: child.id,
      agentId,
      type: info?.type ?? "subagent",
      model: child.model,
      tokens: child.inputTokens + child.outputTokens,
      toolCallCount: child.toolCallCount,
      durationMs: child.durationMs,
      status,
      spawnReason: info?.spawnReason,
      depth: 1,
    };
  });
}

// --- Token economics: whole-session (main + every sub-agent) token spend, grouped by agent and
// by model, plus a cache-reuse summary. -----------------------------------------------------

function buildTokenEconomics(session: TAiSession, agents: TSessionAgent[], children: TAiSession[]): TSessionAdvisor["tokenEconomics"] {
  const sessionTokens = session.inputTokens + session.outputTokens;
  const byAgent = [{ label: "main", tokens: sessionTokens }, ...agents.map((agent) => ({ label: agent.type, tokens: agent.tokens }))];

  const modelTotals = new Map<string, number>();
  const addModel = (model: string, tokens: number): void => {
    const key = model || "unknown";
    modelTotals.set(key, (modelTotals.get(key) ?? 0) + tokens);
  };
  addModel(session.model, sessionTokens);
  for (const agent of agents) addModel(agent.model, agent.tokens);
  const byModel = [...modelTotals.entries()].map(([label, tokens]) => ({ label, tokens }));

  const cacheReadTokens = session.cacheReadTokens + children.reduce((sum, child) => sum + child.cacheReadTokens, 0);
  const cacheCreationTokens = session.cacheCreationTokens + children.reduce((sum, child) => sum + child.cacheCreationTokens, 0);
  const cacheTotal = cacheReadTokens + cacheCreationTokens;

  return {
    totalTokens: byAgent.reduce((sum, entry) => sum + entry.tokens, 0),
    byAgent,
    byModel,
    cacheReadTokens,
    cacheCreationTokens,
    cacheReusePercent: cacheTotal >= 1000 ? Math.round((cacheReadTokens / cacheTotal) * 100) : undefined,
  };
}

// --- Recommendations: one per dimension that scored below the threshold, phrased in
// tokens/percent (this project deliberately has no cost/pricing table — see ai-types.ts). --------

function buildRecommendations(
  session: TAiSession,
  scores: { context: number; cache: number; modelFit: number; orchestration: number },
  dominant: TDominantAgent | undefined,
): TAdvisorRecommendation[] {
  const recommendations: TAdvisorRecommendation[] = [];
  const severityOf = (score: number): TAdvisorRecommendation["severity"] => (score < CRITICAL_THRESHOLD ? "critical" : "warning");

  if (scores.context < RECOMMENDATION_THRESHOLD) {
    const used = session.inputTokens + session.outputTokens;
    const percent = session.contextWindowTokens > 0 ? Math.round((used / session.contextWindowTokens) * 100) : 0;
    recommendations.push({
      category: "context",
      severity: severityOf(scores.context),
      title: "Approaching context limit",
      detail: `This session is at ~${percent}% of ${session.model || "its model"}'s ~${formatCompact(session.contextWindowTokens)}-token context window. Plan a natural stopping point, or compact, before it fills up.`,
      metric: `${percent}%`,
    });
  }

  const cacheTotal = session.cacheReadTokens + session.cacheCreationTokens;
  if (scores.cache < RECOMMENDATION_THRESHOLD && cacheTotal >= 1000) {
    const reusePercent = Math.round((session.cacheReadTokens / cacheTotal) * 100);
    recommendations.push({
      category: "cache",
      severity: severityOf(scores.cache),
      title: "Low cache reuse",
      detail: `Only ${reusePercent}% of cacheable input came from cache (${formatCompact(session.cacheReadTokens)} reused vs ${formatCompact(session.cacheCreationTokens)} freshly cached). A stable prompt prefix between turns lets more of it be served from cache.`,
      metric: `${reusePercent}%`,
    });
  }

  if (scores.modelFit < RECOMMENDATION_THRESHOLD) {
    recommendations.push({
      category: "model-fit",
      severity: severityOf(scores.modelFit),
      title: "Premium model on a low-output task",
      detail: `${session.model} handled ${session.toolCallCount} tool calls but produced comparatively little output (${formatCompact(session.outputTokens)} tokens). Read-heavy, narrow tasks are often cheaper on a lighter model.`,
    });
  }

  if (scores.orchestration < RECOMMENDATION_THRESHOLD && dominant) {
    const sharePercent = Math.round(dominant.share * 100);
    const narrow = scores.orchestration <= 35;
    recommendations.push({
      category: "orchestration",
      severity: severityOf(scores.orchestration),
      title: `Expensive sub-agent: ${dominant.type}`,
      detail: narrow
        ? `${dominant.type} spent ${formatCompact(dominant.tokens)} tokens (${sharePercent}% of the session) across only ${dominant.toolCallCount} tool call${dominant.toolCallCount === 1 ? "" : "s"} — for narrow lookups a direct Grep/Read is often cheaper than spawning an agent.`
        : `${dominant.type} accounts for ${sharePercent}% of this session's total token spend (${formatCompact(dominant.tokens)} tokens across ${dominant.toolCallCount} tool calls). Worth checking whether its scope could be narrowed.`,
      metric: `${sharePercent}%`,
    });
  }

  return recommendations;
}

function neutralAdvisor(session: TAiSession): TSessionAdvisor {
  return {
    neutral: true,
    grade: "",
    score: 0,
    dimensions: [],
    recommendations: [],
    agents: [],
    tokenEconomics: {
      totalTokens: session.inputTokens + session.outputTokens,
      byAgent: [],
      byModel: [],
      cacheReadTokens: session.cacheReadTokens,
      cacheCreationTokens: session.cacheCreationTokens,
      cacheReusePercent: undefined,
    },
  };
}

/** Full Advisor: grade, dimension breakdown, ranked recommendations, the whole-session
 *  orchestration tree, and token economics. Needs the session's children (sub-agent sessions)
 *  and its own observations (to join agent identity/spawn reason) — see AiSessionStore.listChildSessions
 *  and AiSessionStore.getObservations. */
export function computeAdvisor(session: TAiSession, children: TAiSession[], parentObservations: TAiObservation[]): TSessionAdvisor {
  const totalTokens = session.inputTokens + session.outputTokens;
  if (totalTokens < NEUTRAL_TOKEN_THRESHOLD) return neutralAdvisor(session);

  const agents = buildAgents(children, parentObservations);

  const contextScore = contextHealthScore(session);
  const cacheScore = cacheEfficiencyScore(session);
  const modelFit = modelFitScore(session);
  const { score: orchestrationScoreValue, dominant } = orchestrationScore(totalTokens, agents);

  const dimensions: TAdvisorDimension[] = [
    { label: "Context health", score: Math.round(contextScore) },
    { label: "Cache efficiency", score: Math.round(cacheScore) },
    { label: "Model fit", score: Math.round(modelFit) },
    { label: "Orchestration", score: Math.round(orchestrationScoreValue) },
  ];
  const score = Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score, 0) / dimensions.length);

  return {
    neutral: false,
    grade: scoreToGrade(score),
    score,
    dimensions,
    recommendations: buildRecommendations(session, { context: contextScore, cache: cacheScore, modelFit, orchestration: orchestrationScoreValue }, dominant),
    agents,
    tokenEconomics: buildTokenEconomics(session, agents, children),
  };
}

/** Cheap grade estimate computable from a single TAiSession row (no children/observations join)
 *  — used for the session-list cards so paging through 50 sessions doesn't fan out into 50
 *  observation-table scans. Omits the orchestration dimension, so a session's list-card grade
 *  can differ slightly from its detail-view grade once sub-agents are involved. */
export function computeQuickGrade(session: TAiSession): { grade: "A" | "B" | "C" | "D" | "F"; score: number } | undefined {
  if (session.inputTokens + session.outputTokens < NEUTRAL_TOKEN_THRESHOLD) return undefined;
  const scores = [contextHealthScore(session), cacheEfficiencyScore(session), modelFitScore(session)];
  const score = Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length);
  return { grade: scoreToGrade(score), score };
}
