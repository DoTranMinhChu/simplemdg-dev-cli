import { describe, expect, it } from "vitest";
import { PluginCycleError, PluginNotFoundError, findReverseDependents, resolveInstallOrder } from "./plugin-graph";
import type { TPluginManifest } from "./plugin-types";

function manifest(id: string, dependsOn: string[] = []): TPluginManifest {
  return {
    id,
    version: "1.0.0",
    displayName: id,
    description: id,
    kind: "agent",
    dependsOn,
    components: {},
  };
}

function registryOf(...manifests: TPluginManifest[]): Map<string, TPluginManifest> {
  return new Map(manifests.map((item) => [item.id, item]));
}

describe("resolveInstallOrder", () => {
  it("orders a simple chain dependencies-first", () => {
    const registry = registryOf(manifest("a", ["b"]), manifest("b", ["c"]), manifest("c"));
    expect(resolveInstallOrder(registry, ["a"])).toEqual(["c", "b", "a"]);
  });

  it("dedupes a shared dependency across multiple requested plugins", () => {
    const registry = registryOf(manifest("shared"), manifest("b1", ["shared"]), manifest("b2", ["shared"]));
    const order = resolveInstallOrder(registry, ["b1", "b2"]);
    expect(order.filter((id) => id === "shared")).toHaveLength(1);
    expect(order.indexOf("shared")).toBeLessThan(order.indexOf("b1"));
    expect(order.indexOf("shared")).toBeLessThan(order.indexOf("b2"));
    expect(order).toEqual(["shared", "b1", "b2"]);
  });

  it("throws PluginCycleError with the exact cycle path", () => {
    const registry = registryOf(manifest("a", ["b"]), manifest("b", ["a"]));
    try {
      resolveInstallOrder(registry, ["a"]);
      expect.fail("expected a PluginCycleError to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PluginCycleError);
      expect((error as PluginCycleError).cyclePath).toEqual(["a", "b", "a"]);
    }
  });

  it("throws PluginNotFoundError for an unknown dependency", () => {
    const registry = registryOf(manifest("a", ["missing"]));
    expect(() => resolveInstallOrder(registry, ["a"])).toThrow(PluginNotFoundError);
  });
});

describe("findReverseDependents", () => {
  it("finds direct and transitive dependents of a shared plugin", () => {
    const registry = registryOf(
      manifest("smdg-playwright-browsers"),
      manifest("smdg-jira-fetcher", ["smdg-playwright-browsers"]),
      manifest("smdg-jira-reproducer", ["smdg-playwright-browsers"]),
      manifest("smdg-jira-fix-issue", ["smdg-jira-fetcher", "smdg-jira-reproducer"]),
    );
    const installedIds = ["smdg-playwright-browsers", "smdg-jira-fetcher", "smdg-jira-reproducer", "smdg-jira-fix-issue"];

    const dependents = findReverseDependents(registry, installedIds, "smdg-playwright-browsers");

    expect(dependents.sort()).toEqual(["smdg-jira-fetcher", "smdg-jira-fix-issue", "smdg-jira-reproducer"].sort());
  });

  it("returns an empty list when nothing depends on the target", () => {
    const registry = registryOf(manifest("a"), manifest("b"));
    expect(findReverseDependents(registry, ["a", "b"], "a")).toEqual([]);
  });

  it("skips a candidate whose own dependencies can't be resolved rather than throwing", () => {
    const registry = registryOf(manifest("a"), manifest("broken", ["missing-dep"]));
    expect(findReverseDependents(registry, ["a", "broken"], "a")).toEqual([]);
  });
});
