import { describe, expect, it } from "vitest";
import { mergeStatusBreakdowns, validateRawWhere } from "./audit-log-query-service";

describe("mergeStatusBreakdowns", () => {
  it("sums counts for the same value across multiple tables and sorts descending", () => {
    const merged = mergeStatusBreakdowns([
      [
        { value: "ACTIVATED", count: 10 },
        { value: "FAILED", count: 3 },
      ],
      [
        { value: "ACTIVATED", count: 5 },
        { value: "PENDING", count: 7 },
      ],
    ]);
    expect(merged).toEqual([
      { value: "ACTIVATED", count: 15 },
      { value: "PENDING", count: 7 },
      { value: "FAILED", count: 3 },
    ]);
  });

  it("caps the merged result at the given limit", () => {
    const perTable = [Array.from({ length: 30 }, (_, index) => ({ value: `S${index}`, count: 30 - index }))];
    const merged = mergeStatusBreakdowns(perTable, 5);
    expect(merged).toHaveLength(5);
    expect(merged?.[0]).toEqual({ value: "S0", count: 30 });
  });

  it("returns undefined when every table's breakdown is undefined", () => {
    expect(mergeStatusBreakdowns([undefined, undefined])).toBeUndefined();
  });

  it("ignores undefined entries mixed with real ones", () => {
    const merged = mergeStatusBreakdowns([undefined, [{ value: "OK", count: 2 }]]);
    expect(merged).toEqual([{ value: "OK", count: 2 }]);
  });
});

describe("validateRawWhere", () => {
  it("rejects an empty fragment", () => {
    const result = validateRawWhere("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects a fragment containing a semicolon", () => {
    const result = validateRawWhere("STATUS = 'A'; DROP TABLE FOO");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/semicolon/i);
  });

  it("rejects a fragment containing a destructive keyword even without a semicolon", () => {
    const result = validateRawWhere("1=1 OR EXISTS (SELECT 1 FROM FOO) OR DELETE FROM FOO");
    expect(result.ok).toBe(false);
  });

  it("accepts a plain structured fragment", () => {
    const result = validateRawWhere("STATUS = 'FAILED' AND CREATEDAT >= '2026-01-01'");
    expect(result.ok).toBe(true);
  });
});
