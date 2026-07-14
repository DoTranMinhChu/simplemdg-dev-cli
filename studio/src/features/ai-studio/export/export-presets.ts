import type { TAiExportInclude, TAiExportPreset } from "../../../api/ai-studio-api-types";

const PRESET_TABLE: Record<Exclude<TAiExportPreset, "custom">, TAiExportInclude> = {
  conversation: { conversation: true, toolCalls: false, toolOutputs: false, reasoning: false, files: false, commands: false, errors: false, verification: false, rawMetadata: false },
  learning: { conversation: true, toolCalls: true, toolOutputs: false, reasoning: false, files: false, commands: false, errors: false, verification: true, rawMetadata: false },
  engineering: { conversation: true, toolCalls: true, toolOutputs: true, reasoning: false, files: true, commands: true, errors: true, verification: true, rawMetadata: false },
  full: { conversation: true, toolCalls: true, toolOutputs: true, reasoning: true, files: true, commands: true, errors: true, verification: true, rawMetadata: true },
};

const ALL_EXCLUDED: TAiExportInclude = {
  conversation: false,
  toolCalls: false,
  toolOutputs: false,
  reasoning: false,
  files: false,
  commands: false,
  errors: false,
  verification: false,
  rawMetadata: false,
};

/** Mirrors the backend's resolveInclude() (src/core/ai/export/ai-export-types.ts) — kept as a thin
 *  client copy, same convention already used for the API type mirrors in this file's neighbors. */
export function includeForPreset(preset: TAiExportPreset, custom: TAiExportInclude = ALL_EXCLUDED): TAiExportInclude {
  return preset === "custom" ? custom : PRESET_TABLE[preset];
}

/** Detects whether a hand-edited include set still matches a known preset, so the UI can snap back
 *  to that preset's label instead of showing "Custom" for a set the user reconstructed by hand. */
export function matchingPreset(include: TAiExportInclude): TAiExportPreset {
  for (const preset of Object.keys(PRESET_TABLE) as Array<Exclude<TAiExportPreset, "custom">>) {
    if ((Object.keys(PRESET_TABLE[preset]) as Array<keyof TAiExportInclude>).every((key) => PRESET_TABLE[preset][key] === include[key])) return preset;
  }
  return "custom";
}

export const PRESET_LABELS: Record<TAiExportPreset, string> = {
  conversation: "Conversation Only",
  learning: "Learning Package",
  engineering: "Engineering Review",
  full: "Full Technical Archive",
  custom: "Custom",
};

export const INCLUDE_LABELS: Record<keyof TAiExportInclude, string> = {
  conversation: "Conversation (user + assistant messages)",
  toolCalls: "Tool call summaries",
  toolOutputs: "Full tool input/output",
  reasoning: "Internal reasoning",
  files: "Files changed",
  commands: "Shell commands",
  errors: "Errors",
  verification: "Verification checks",
  rawMetadata: "Raw observation metadata",
};

export const INCLUDE_KEYS = Object.keys(INCLUDE_LABELS) as Array<keyof TAiExportInclude>;
