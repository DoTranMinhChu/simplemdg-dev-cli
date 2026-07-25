import { describe, expect, it } from "vitest";
import { runKnownFixups } from "./cds-upgrade-fixups";
import type { TCdsFixupContext } from "./cds-upgrade-fixups";

function makeContext(packageJson: Record<string, unknown>, toMajor = 9, fromMajor = 8): TCdsFixupContext {
  return { packageJson, fromMajor, toMajor };
}

describe("cds-upgrade-fixups", () => {
  describe("legacy-build-config", () => {
    it("reports (does not auto-fix) legacy cds.data build config when jumping to cds9", () => {
      const ctx = makeContext({ cds: { data: { model: "db/foo" } } });
      const { changed, results } = runKnownFixups(ctx);
      const found = results.find((r) => r.id === "legacy-build-config");
      expect(found).toBeDefined();
      expect(found?.applied).toBe(false);
      expect(changed).toBe(false);
    });

    it("reports legacy cds.service build config too", () => {
      const ctx = makeContext({ cds: { service: { to: "hana" } } });
      const { results } = runKnownFixups(ctx);
      expect(results.some((r) => r.id === "legacy-build-config")).toBe(true);
    });

    it("does not fire when jumping to a version below cds9", () => {
      const ctx = makeContext({ cds: { data: { model: "db/foo" } } }, 8, 7);
      const { results } = runKnownFixups(ctx);
      expect(results.some((r) => r.id === "legacy-build-config")).toBe(false);
    });

    it("does not fire when no legacy config exists", () => {
      const ctx = makeContext({ cds: { build: { tasks: [] } } });
      const { results } = runKnownFixups(ctx);
      expect(results.some((r) => r.id === "legacy-build-config")).toBe(false);
    });
  });

  describe("cds-test-devdependency", () => {
    it("adds @cap-js/cds-test when a real test script exists and it's missing", () => {
      const ctx = makeContext({ scripts: { test: "vitest run" }, devDependencies: {} });
      const { changed, results } = runKnownFixups(ctx);
      expect(changed).toBe(true);
      expect(results.find((r) => r.id === "cds-test-devdependency")?.applied).toBe(true);
      expect((ctx.packageJson.devDependencies as Record<string, string>)["@cap-js/cds-test"]).toBe("^1");
    });

    it("does not fire for the default npm-init placeholder test script", () => {
      const ctx = makeContext({ scripts: { test: "echo \"Error: no test specified\" && exit 1" } });
      const { results } = runKnownFixups(ctx);
      expect(results.some((r) => r.id === "cds-test-devdependency")).toBe(false);
    });

    it("does not fire when @cap-js/cds-test is already present (idempotent)", () => {
      const ctx = makeContext({ scripts: { test: "vitest run" }, devDependencies: { "@cap-js/cds-test": "^1.2.0" } });
      const { changed, results } = runKnownFixups(ctx);
      expect(changed).toBe(false);
      expect(results.some((r) => r.id === "cds-test-devdependency")).toBe(false);
    });

    it("running twice in a row is a no-op the second time", () => {
      const ctx = makeContext({ scripts: { test: "vitest run" }, devDependencies: {} });
      const first = runKnownFixups(ctx);
      expect(first.changed).toBe(true);
      const second = runKnownFixups(ctx);
      expect(second.changed).toBe(false);
    });
  });

  describe("eslint-v9-devdependency", () => {
    it("bumps an existing pre-v9 eslint devDependency when cds lint is used", () => {
      const ctx = makeContext({ scripts: { lint: "cds lint" }, devDependencies: { eslint: "^8.0.0" } });
      const { changed, results } = runKnownFixups(ctx);
      expect(changed).toBe(true);
      expect(results.find((r) => r.id === "eslint-v9-devdependency")?.applied).toBe(true);
      expect((ctx.packageJson.devDependencies as Record<string, string>).eslint).toBe("^9");
    });

    it("does not introduce eslint to a repo that never used it", () => {
      const ctx = makeContext({ scripts: { build: "cds build" }, devDependencies: {} });
      const { results } = runKnownFixups(ctx);
      expect(results.some((r) => r.id === "eslint-v9-devdependency")).toBe(false);
    });

    it("does not fire when eslint is already v9+ (idempotent)", () => {
      const ctx = makeContext({ scripts: { lint: "eslint ." }, devDependencies: { eslint: "^9.5.0" } });
      const { changed, results } = runKnownFixups(ctx);
      expect(changed).toBe(false);
      expect(results.some((r) => r.id === "eslint-v9-devdependency")).toBe(false);
    });
  });

  it("applies multiple rules independently in one pass", () => {
    const ctx = makeContext({
      scripts: { test: "vitest run", lint: "cds lint" },
      devDependencies: { eslint: "^8.0.0" },
    });
    const { results } = runKnownFixups(ctx);
    expect(results.filter((r) => r.applied).map((r) => r.id).sort()).toEqual(["cds-test-devdependency", "eslint-v9-devdependency"]);
  });

  it("no rules fire on a package.json that needs nothing", () => {
    const ctx = makeContext({ devDependencies: { eslint: "^9" } });
    const { changed, results } = runKnownFixups(ctx);
    expect(changed).toBe(false);
    expect(results).toEqual([]);
  });
});
