import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { buildCommandRegistry } from "./command-registry";

function buildFakeProgram(): Command {
  const program = new Command();
  program.name("simplemdg");

  const git = program.command("git").description("Git workflow helpers");
  git.command("move-code").description("Guided workflow").alias("move");
  git.command("summary").description("Show summary");

  const cf = program.command("cf").description("Cloud Foundry and BTP tools");
  cf.command("apps").description("List BTP apps");
  const db = cf.command("db").description("Database tools");
  db.command("studio").description("Open Database Studio");

  const cds = program.command("cds").description("SAP CAP dev server helpers");
  cds.command("watch").description("Run cds watch");

  program.command("doctor").description("Diagnose environment");

  return program;
}

describe("buildCommandRegistry", () => {
  it("derives only leaf commands, excluding groups", () => {
    const registry = buildCommandRegistry(buildFakeProgram());
    const ids = registry.map((command) => command.id);

    expect(ids).toContain("git.move-code");
    expect(ids).toContain("cf.db.studio");
    expect(ids).toContain("doctor");
    expect(ids).not.toContain("git");
    expect(ids).not.toContain("cf");
    expect(ids).not.toContain("cf.db");
  });

  it("produces a unique id per leaf", () => {
    const registry = buildCommandRegistry(buildFakeProgram());
    const ids = registry.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives description/aliases straight from Commander (single source of truth)", () => {
    const registry = buildCommandRegistry(buildFakeProgram());
    const moveCode = registry.find((command) => command.id === "git.move-code");

    expect(moveCode?.description).toBe("Guided workflow");
    expect(moveCode?.aliases).toContain("move");
  });

  it("merges category/keywords from the metadata overlay when present, and falls back sensibly otherwise", () => {
    const registry = buildCommandRegistry(buildFakeProgram());
    const moveCode = registry.find((command) => command.id === "git.move-code");
    expect(moveCode?.category).toBe("Git");
    expect(moveCode?.keywords).toContain("move code");

    const doctor = registry.find((command) => command.id === "doctor");
    expect(doctor?.category).toBe("General");
    expect(doctor?.keywords).toEqual([]);
  });

  it("marks natively-migrated commands as 'native' and defaults everything else to 'direct-only'", () => {
    // Regression guard: a command must never silently run in-shell unless it's
    // explicitly opted into "native" — direct-only is the safe default.
    const registry = buildCommandRegistry(buildFakeProgram());
    const moveCode = registry.find((command) => command.id === "git.move-code");
    const summary = registry.find((command) => command.id === "git.summary");
    const dbStudio = registry.find((command) => command.id === "cf.db.studio");
    const cdsWatch = registry.find((command) => command.id === "cds.watch");
    const doctor = registry.find((command) => command.id === "doctor");

    expect(moveCode?.interactiveCapability).toBe("native");
    expect(summary?.interactiveCapability).toBe("direct-only");
    // cf.db.studio is a Studio (background-status) session, also explicitly opted into "native" — see command-registry-metadata.ts.
    expect(dbStudio?.interactiveCapability).toBe("native");
    // cds.watch has other overlay fields set (category/keywords) but no interactiveCapability flag — still defaults to direct-only.
    expect(cdsWatch?.interactiveCapability).toBe("direct-only");
    expect(doctor?.interactiveCapability).toBe("direct-only");
  });
});
