import { describe, expect, it } from "vitest";
import { searchCommands } from "./command-search";
import type { TInteractiveCommandDefinition } from "./command-registry";

function makeCommand(overrides: Partial<TInteractiveCommandDefinition>): TInteractiveCommandDefinition {
  return {
    id: "git.move-code",
    path: ["git", "move-code"],
    title: "git move-code",
    description: "Guided workflow: search, cherry-pick, resolve conflicts, build",
    category: "Git",
    aliases: ["move"],
    keywords: ["move code", "cherry-pick", "uat"],
    command: {} as TInteractiveCommandDefinition["command"],
    ...overrides,
  };
}

describe("searchCommands", () => {
  const moveCode = makeCommand({});
  const dbStudio = makeCommand({
    id: "cf.db.studio",
    path: ["cf", "db", "studio"],
    title: "cf db studio",
    description: "Open SimpleMDG Database Studio",
    category: "Cloud Foundry",
    aliases: [],
    keywords: ["open db", "database studio", "hana"],
  });

  it("returns everything, unscored, for an empty query", () => {
    const results = searchCommands("", [moveCode, dbStudio]);
    expect(results.map((r) => r.command.id)).toEqual([moveCode.id, dbStudio.id]);
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it("finds a command via its natural-language keyword", () => {
    const results = searchCommands("move code", [moveCode, dbStudio]);
    expect(results[0]?.command.id).toBe(moveCode.id);
  });

  it("finds a command via a natural-language alias phrase for a different command", () => {
    const results = searchCommands("open db", [moveCode, dbStudio]);
    expect(results[0]?.command.id).toBe(dbStudio.id);
  });

  it("excludes commands with no match at all", () => {
    const results = searchCommands("zzz-no-match", [moveCode, dbStudio]);
    expect(results).toEqual([]);
  });

  it("ranks a higher-scoring match first", () => {
    const results = searchCommands("db studio", [moveCode, dbStudio]);
    expect(results[0]?.command.id).toBe(dbStudio.id);
  });
});
