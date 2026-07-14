import { describe, expect, it } from "vitest";
import { redactArgs } from "./command-history";

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
