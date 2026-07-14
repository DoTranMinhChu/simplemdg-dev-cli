import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { CommandPalette } from "./CommandPalette";
import { TerminalContextProvider, type TTerminalContextValue } from "../app/TerminalContext";
import { resolveTerminalTheme } from "../services/terminal-theme";
import type { TInteractiveCommandDefinition } from "../services/command-registry";

const testContextValue: TTerminalContextValue = {
  theme: resolveTerminalTheme({ noColor: true }),
  capabilities: { isTTY: true, isCI: false, noColor: true, supportsUnicode: true, columns: 80, rows: 24 },
  registry: [],
  projectName: "test-project",
};

function makeCommand(id: string, path: string[], description: string, category: string, keywords: string[] = []): TInteractiveCommandDefinition {
  return {
    id,
    path,
    title: path.join(" "),
    description,
    category,
    aliases: [],
    keywords,
    command: {} as TInteractiveCommandDefinition["command"],
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("CommandPalette", () => {
  it("lists every command when no query has been typed yet", () => {
    const commands = [
      makeCommand("git.move-code", ["git", "move-code"], "Guided workflow", "Git", ["move code"]),
      makeCommand("cf.db.studio", ["cf", "db", "studio"], "Open Database Studio", "Cloud Foundry", ["open db"]),
    ];

    const { lastFrame } = render(
      <TerminalContextProvider value={testContextValue}>
        <CommandPalette commands={commands} recentIds={[]} favoriteIds={[]} onSubmit={() => undefined} onCancel={() => undefined} />
      </TerminalContextProvider>,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("git move-code");
    expect(frame).toContain("cf db studio");
  });

  it("fuzzy-filters commands as the user types", async () => {
    const commands = [
      makeCommand("git.move-code", ["git", "move-code"], "Guided workflow", "Git", ["move code"]),
      makeCommand("cf.db.studio", ["cf", "db", "studio"], "Open Database Studio", "Cloud Foundry", ["open db"]),
    ];

    const { lastFrame, stdin } = render(
      <TerminalContextProvider value={testContextValue}>
        <CommandPalette commands={commands} recentIds={[]} favoriteIds={[]} onSubmit={() => undefined} onCancel={() => undefined} />
      </TerminalContextProvider>,
    );

    // Ink attaches its raw-mode stdin listener from a useEffect, which only
    // flushes after this initial tick — writing synchronously right after
    // render() would be dropped before any listener exists.
    await wait(50);
    stdin.write("db");
    await wait(50);

    const frame = lastFrame() ?? "";
    expect(frame).toContain("cf db studio");
    expect(frame).not.toContain("git move-code");
  });
});
