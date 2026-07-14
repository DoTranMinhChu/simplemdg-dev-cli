import { describe, expect, it } from "vitest";
import { dedupeHistoryEntries, redactArgs, type TCommandHistoryEntry } from "./command-history";

function makeEntry(id: string, timestamp: string): TCommandHistoryEntry {
  return { id, path: id.split("."), args: [], timestamp, durationMs: 0, success: true };
}

describe("redactArgs", () => {
  it("redacts the value of a --token=value style flag", () => {
    expect(redactArgs(["--token=abc123secret"])).toEqual(["--token=[redacted]"]);
  });

  it("redacts the value of a --password value style flag pair", () => {
    expect(redactArgs(["--password", "hunter2"])).toEqual(["--password", "[redacted]"]);
  });

  it("redacts secret/credential/apiKey-shaped flags", () => {
    expect(redactArgs(["--secret", "s3cr3t"])).toEqual(["--secret", "[redacted]"]);
    expect(redactArgs(["--credential", "abc"])).toEqual(["--credential", "[redacted]"]);
    expect(redactArgs(["--api-key", "abc"])).toEqual(["--api-key", "[redacted]"]);
  });

  it("leaves ordinary flags and values untouched", () => {
    const args = ["--source", "staging", "--target", "uat", "--scope", "SJS-2158"];
    expect(redactArgs(args)).toEqual(args);
  });

  it("does not treat the next flag as a value to redact", () => {
    expect(redactArgs(["--token", "--dry-run"])).toEqual(["--token", "--dry-run"]);
  });
});

describe("dedupeHistoryEntries", () => {
  it("keeps only the first (most recent) occurrence of a repeated command", () => {
    // Regression test: running the same command twice used to make it show up
    // twice in both "Recent actions" and the command palette.
    const entries = [
      makeEntry("ai.studio", "2026-07-14T10:03:00.000Z"),
      makeEntry("cf.apps", "2026-07-14T10:02:00.000Z"),
      makeEntry("ai.studio", "2026-07-14T10:01:00.000Z"),
      makeEntry("cf.org", "2026-07-14T10:00:00.000Z"),
    ];

    const result = dedupeHistoryEntries(entries, 10);

    expect(result.map((entry) => entry.id)).toEqual(["ai.studio", "cf.apps", "cf.org"]);
  });

  it("respects the limit after deduping", () => {
    const entries = [makeEntry("a", "t1"), makeEntry("b", "t2"), makeEntry("c", "t3")];
    expect(dedupeHistoryEntries(entries, 2).map((entry) => entry.id)).toEqual(["a", "b"]);
  });
});
