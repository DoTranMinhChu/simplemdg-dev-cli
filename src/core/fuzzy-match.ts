/**
 * Shared fuzzy-match scoring used by both the traditional `prompts`-based
 * searchable selects (src/core/prompts.ts) and the interactive shell's
 * SearchableList/CommandPalette, so filtering feels identical in both modes.
 */
export function scoreMatch(input: string, value: string): number {
  const normalizedInput = input.toLowerCase().trim();
  const normalizedValue = value.toLowerCase();

  if (!normalizedInput) {
    return 0;
  }

  if (normalizedValue === normalizedInput) {
    return 100;
  }

  if (normalizedValue.startsWith(normalizedInput)) {
    return 80;
  }

  if (normalizedValue.includes(normalizedInput)) {
    return 60;
  }

  const inputParts = normalizedInput.split(/\s+/).filter(Boolean);

  if (inputParts.every((part) => normalizedValue.includes(part))) {
    return 40;
  }

  return -1;
}

/** Best score for `input` across several candidate strings (e.g. title + value + keywords). */
export function bestScoreMatch(input: string, values: string[]): number {
  return values.reduce((best, value) => Math.max(best, scoreMatch(input, value)), -1);
}
