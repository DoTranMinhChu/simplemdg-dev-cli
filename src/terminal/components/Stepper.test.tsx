import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { Stepper } from "./Stepper";
import { TerminalContextProvider, type TTerminalContextValue } from "../app/TerminalContext";
import { resolveTerminalTheme } from "../services/terminal-theme";

const testContextValue: TTerminalContextValue = {
  theme: resolveTerminalTheme({ noColor: true }),
  capabilities: { isTTY: true, isCI: false, noColor: true, supportsUnicode: true, columns: 80, rows: 24 },
  registry: [],
  projectName: "test-project",
};

describe("Stepper", () => {
  it("renders each step with the done/active/pending symbol relative to currentIndex", () => {
    const { lastFrame } = render(
      <TerminalContextProvider value={testContextValue}>
        <Stepper steps={["Repository", "Branches", "Scope", "Commits"]} currentIndex={2} />
      </TerminalContextProvider>,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 ✓ Repository");
    expect(frame).toContain("2 ✓ Branches");
    expect(frame).toContain("3 ● Scope");
    expect(frame).toContain("4 ○ Commits");
  });

  it("falls back to ASCII symbols when the terminal doesn't support unicode", () => {
    const { lastFrame } = render(
      <TerminalContextProvider value={testContextValue}>
        <Stepper steps={["Repository", "Scope"]} currentIndex={1} supportsUnicode={false} />
      </TerminalContextProvider>,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("1 + Repository");
    expect(frame).toContain("2 * Scope");
  });
});
