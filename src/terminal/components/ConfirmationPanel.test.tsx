import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmationPanel } from "./ConfirmationPanel";
import { TerminalContextProvider, type TTerminalContextValue } from "../app/TerminalContext";
import { resolveTerminalTheme } from "../services/terminal-theme";

const ESCAPE_KEY = String.fromCharCode(27);
const RIGHT_ARROW = `${ESCAPE_KEY}[C`;
const LEFT_ARROW = `${ESCAPE_KEY}[D`;

const testContextValue: TTerminalContextValue = {
  theme: resolveTerminalTheme({ noColor: true }),
  capabilities: { isTTY: true, isCI: false, noColor: true, supportsUnicode: true, columns: 80, rows: 24 },
  registry: [],
  projectName: "test-project",
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ConfirmationPanel", () => {
  it(
    "does not crash on an arrow-key press — regression test for the reported " +
      "'Mark this target as favorite?' crash (prompts' ConfirmPrompt threw " +
      "TypeError: Cannot read properties of undefined (reading 'toLowerCase') " +
      "on any keypress it didn't recognize as y/n/Enter/Escape)",
    async () => {
      const onSubmit = vi.fn();
      const onCancel = vi.fn();

      const { stdin, lastFrame } = render(
        <TerminalContextProvider value={testContextValue}>
          <ConfirmationPanel message="Mark this target as favorite?" initial={false} onSubmit={onSubmit} onCancel={onCancel} />
        </TerminalContextProvider>,
      );

      await wait(50);

      // The exact class of input that crashed the legacy `prompts` confirm widget.
      stdin.write(RIGHT_ARROW);
      await wait(20);
      stdin.write(LEFT_ARROW);
      await wait(20);
      stdin.write("\t");
      await wait(20);

      // Still alive, still showing the same prompt, no submit/cancel fired.
      expect(lastFrame()).toContain("Mark this target as favorite?");
      expect(onSubmit).not.toHaveBeenCalled();
      expect(onCancel).not.toHaveBeenCalled();

      stdin.write("y");
      await wait(50);
      expect(onSubmit).toHaveBeenCalledWith(true);
    },
  );

  it("still submits false on 'n' and cancels on Escape", async () => {
    const onSubmitN = vi.fn();
    const { stdin: stdinN } = render(
      <TerminalContextProvider value={testContextValue}>
        <ConfirmationPanel message="Continue?" onSubmit={onSubmitN} onCancel={() => undefined} />
      </TerminalContextProvider>,
    );
    await wait(50);
    stdinN.write("n");
    await wait(50);
    expect(onSubmitN).toHaveBeenCalledWith(false);

    const onCancelEsc = vi.fn();
    const { stdin: stdinEsc } = render(
      <TerminalContextProvider value={testContextValue}>
        <ConfirmationPanel message="Continue?" onSubmit={() => undefined} onCancel={onCancelEsc} />
      </TerminalContextProvider>,
    );
    await wait(50);
    stdinEsc.write(ESCAPE_KEY);
    await wait(50);
    expect(onCancelEsc).toHaveBeenCalled();
  });
});
