import { describe, expect, it } from "vitest";
import { bestScoreMatch, scoreMatch } from "./fuzzy-match";

describe("scoreMatch", () => {
  it("scores an exact match highest", () => {
    expect(scoreMatch("staging", "staging")).toBe(100);
  });

  it("scores a prefix match above a substring match", () => {
    expect(scoreMatch("stag", "staging")).toBeGreaterThan(scoreMatch("agi", "staging"));
  });

  it("scores a substring match above a scattered-words match", () => {
    expect(scoreMatch("agi", "staging")).toBeGreaterThan(scoreMatch("git move", "move scoped git code"));
  });

  it("matches when every whitespace-separated word is present in any order", () => {
    expect(scoreMatch("code move", "move code")).toBeGreaterThanOrEqual(40);
  });

  it("returns -1 when there is no match at all", () => {
    expect(scoreMatch("zzz", "staging")).toBe(-1);
  });

  it("returns 0 for an empty query (no filtering applied)", () => {
    expect(scoreMatch("", "staging")).toBe(0);
  });
});

describe("bestScoreMatch", () => {
  it("returns the highest score across candidate strings", () => {
    const score = bestScoreMatch("move code", ["git move-code", "unrelated description", "move code"]);
    expect(score).toBe(100);
  });

  it("returns -1 when no candidate matches", () => {
    expect(bestScoreMatch("zzz", ["staging", "uat"])).toBe(-1);
  });
});
