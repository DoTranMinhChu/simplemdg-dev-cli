import { ClaudeSessionProvider } from "./providers/claude-session-provider";
import { CodexSessionProvider } from "./providers/codex-session-provider";
import type { IAiSessionProvider } from "./ai-types";

/**
 * Every supported session source. Adding a provider (e.g. Cursor, once a verified parser exists)
 * means implementing `IAiSessionProvider` and adding one line here — ingestion, storage, and the
 * API/UI layers never branch on provider id directly.
 */
export function getAiSessionProviders(): IAiSessionProvider[] {
  return [new ClaudeSessionProvider(), new CodexSessionProvider()];
}
