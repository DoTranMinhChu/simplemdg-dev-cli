import { describe, expect, it } from "vitest";
import { parseDetectChanges, parseGitNexusList, parseGitNexusStatus } from "./nexus-output-parser";

// Fixtures below are verbatim captures from a real `gitnexus@1.6.9` run
// against this repo (2026-07-19) — see the spike notes in the nexus backend
// design. Keeping them literal (not hand-approximated) is the point: these
// tests catch drift against GitNexus's actual output, not our guess at it.

describe("parseGitNexusList", () => {
  it("parses a populated registry", () => {
    const stdout = [
      "",
      "  Indexed Repositories (1)",
      "",
      "  simplemdg-dev-cli",
      "    Path:    C:\\Users\\MikeDo\\Dev\\GitHub\\simplemdg-dev-cli",
      "    Indexed: 7/19/2026, 7:58:03 PM",
      "    Commit:  241e2d5",
      "    Branch:  master",
      "    Stats:   418 files, 4044 symbols, 12466 edges",
      "    Clusters:   238",
      "    Processes:  300",
      "",
    ].join("\n");

    const entries = parseGitNexusList(stdout);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: "simplemdg-dev-cli",
      path: "C:\\Users\\MikeDo\\Dev\\GitHub\\simplemdg-dev-cli",
      commit: "241e2d5",
      branch: "master",
      files: 418,
      symbols: 4044,
      edges: 12466,
      clusters: 238,
      processes: 300,
    });
  });

  it("returns an empty list for unrecognized/empty output rather than throwing", () => {
    expect(parseGitNexusList("No indexed repositories.")).toEqual([]);
    expect(parseGitNexusList("")).toEqual([]);
  });
});

describe("parseGitNexusStatus", () => {
  it("parses an up-to-date repo", () => {
    const stdout = [
      "Repository: C:\\Users\\MikeDo\\Dev\\GitHub\\simplemdg-dev-cli",
      "Branch: master",
      "Indexed: 7/19/2026, 7:58:03 PM",
      "Indexed commit: 241e2d5",
      "Current commit: 241e2d5",
      "Status: up-to-date",
    ].join("\n");

    const info = parseGitNexusStatus(stdout);
    expect(info.branch).toBe("master");
    expect(info.indexedCommit).toBe("241e2d5");
    expect(info.upToDate).toBe(true);
  });

  it("does not crash on unexpected output", () => {
    const info = parseGitNexusStatus("something unexpected");
    expect(info.upToDate).toBeUndefined();
    expect(info.raw).toContain("unexpected");
  });
});

describe("parseDetectChanges", () => {
  it("parses a real 'no changes' result", () => {
    const parsed = parseDetectChanges("No changes detected.");
    expect(parsed.changed).toBe(false);
    expect(parsed.fileCount).toBe(0);
  });

  it("parses a real changed-symbols result and splits name/file per line", () => {
    const stdout = [
      "Changes: 2 files, 3 symbols",
      "Affected processes: 0",
      "Risk level: low",
      "",
      "Changed symbols:",
      "  Symbol SimpleMDG Dev CLI → README.md",
      "  Symbol AI Studio → README.md",
      "  Symbol Commands → README.md",
    ].join("\n");

    const parsed = parseDetectChanges(stdout);
    expect(parsed.changed).toBe(true);
    expect(parsed.fileCount).toBe(2);
    expect(parsed.symbolCount).toBe(3);
    expect(parsed.risk).toBe("low");
    expect(parsed.changedSymbols).toEqual([
      { name: "SimpleMDG Dev CLI", filePath: "README.md" },
      { name: "AI Studio", filePath: "README.md" },
      { name: "Commands", filePath: "README.md" },
    ]);
  });

  it("parses a real high-risk impact-style summary", () => {
    const stdout = ["Changes: 1 files, 1 symbols", "Affected processes: 3", "Risk level: high"].join("\n");
    const parsed = parseDetectChanges(stdout);
    expect(parsed.risk).toBe("high");
    expect(parsed.affectedProcessCount).toBe(3);
  });
});
