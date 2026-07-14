import type { TAiObservationType } from "../../api/ai-studio-api-types";

const ICONS: Record<string, string> = {
  user: "👤",
  assistant: "💬",
  reasoning: "🧠",
  "tool-call": "🔧",
  "shell-command": "▶",
  "mcp-call": "🔌",
  skill: "✨",
  subagent: "🤖",
  command: "⌘",
  error: "⚠",
  // TConversationEntryKind additions (conversation-model.ts) — same glyph language, richer buckets.
  "user-message": "👤",
  "assistant-message": "💬",
  "file-read": "📖",
  "file-write": "🆕",
  "file-edit": "✏️",
  "system-event": "⌘",
};

/** Shared emoji glyph per observation kind — used by the Turns tab and the Graph tab so both read consistently. */
export function observationTypeIcon(type: TAiObservationType | string): string {
  return ICONS[type] ?? "•";
}
