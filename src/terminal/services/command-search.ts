import { bestScoreMatch } from "../../core/fuzzy-match";
import type { TInteractiveCommandDefinition } from "./command-registry";

export type TScoredCommand = {
  command: TInteractiveCommandDefinition;
  score: number;
};

function searchableStrings(command: TInteractiveCommandDefinition): string[] {
  return [command.title, command.description, ...command.aliases, ...command.keywords];
}

/**
 * Fuzzy-filters the registry for the CommandPalette and natural-language
 * discovery ("move code" -> `/git move-code`). Reuses the same scoring
 * function as the traditional searchableSelectChoice prompts, via
 * core/fuzzy-match.ts, so filtering feels identical in both modes.
 */
export function searchCommands(query: string, commands: TInteractiveCommandDefinition[]): TScoredCommand[] {
  const trimmed = query.trim();

  if (!trimmed) {
    return commands.map((command) => ({ command, score: 0 }));
  }

  return commands
    .map((command) => ({ command, score: bestScoreMatch(trimmed, searchableStrings(command)) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score);
}
