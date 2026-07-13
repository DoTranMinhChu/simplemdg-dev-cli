// Best-effort model -> max context window (tokens) table, matched by substring against the
// `model` string observed in session transcripts. Not billing/vendor data — a static estimate
// for the context-usage meter and Advisor scoring, in the same spirit as similar tables shipped
// by other Claude Code observability tools. Update the entries here as models change; unknown
// models fall back to a conservative default rather than hiding the meter entirely.
const CONTEXT_WINDOWS: Array<{ match: string; tokens: number }> = [
  { match: "haiku", tokens: 200_000 },
  { match: "opus", tokens: 200_000 },
  { match: "sonnet", tokens: 1_000_000 },
  { match: "gpt-5", tokens: 400_000 },
  { match: "codex", tokens: 400_000 },
];

const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;

export function getContextWindowTokens(model: string): number {
  const normalized = model.toLowerCase();
  const found = CONTEXT_WINDOWS.find((entry) => normalized.includes(entry.match));
  return found?.tokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
}
