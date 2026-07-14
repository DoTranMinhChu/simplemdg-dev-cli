import { describe, expect, it } from "vitest";
import { canLaunchInteractiveShell, type TTerminalCapabilities } from "./terminal-capabilities";

function makeCapabilities(overrides: Partial<TTerminalCapabilities>): TTerminalCapabilities {
  return {
    isTTY: true,
    isCI: false,
    noColor: false,
    supportsUnicode: true,
    columns: 80,
    rows: 24,
    ...overrides,
  };
}

describe("canLaunchInteractiveShell", () => {
  it("allows the shell on a real interactive TTY outside CI", () => {
    expect(canLaunchInteractiveShell(makeCapabilities({}))).toBe(true);
  });

  it("falls back to plain output when not a TTY (piped/redirected)", () => {
    expect(canLaunchInteractiveShell(makeCapabilities({ isTTY: false }))).toBe(false);
  });

  it("falls back to plain output in CI even if a TTY is somehow reported", () => {
    expect(canLaunchInteractiveShell(makeCapabilities({ isCI: true }))).toBe(false);
  });

  it("falls back when neither a TTY nor CI markers are present", () => {
    expect(canLaunchInteractiveShell(makeCapabilities({ isTTY: false, isCI: false }))).toBe(false);
  });
});
