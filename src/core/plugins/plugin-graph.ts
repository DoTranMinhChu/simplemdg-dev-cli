import type { TPluginManifest } from "./plugin-types";

export type TPluginRegistryMap = Map<string, TPluginManifest>;

export class PluginNotFoundError extends Error {
  constructor(public readonly pluginId: string) {
    super(`Plugin not found in registry: ${pluginId}`);
  }
}

export class PluginCycleError extends Error {
  constructor(public readonly cyclePath: string[]) {
    super(`Dependency cycle detected: ${cyclePath.join(" -> ")}`);
  }
}

type TVisitState = "visiting" | "visited";

/**
 * Resolves a dependency-first (topological), deduped install order for the requested plugin ids.
 * Post-order DFS naturally yields "dependencies before dependents"; a plugin reachable from more
 * than one requested id still only appears once, at the position its first dependents need it.
 */
export function resolveInstallOrder(registry: TPluginRegistryMap, requestedIds: string[]): string[] {
  const state = new Map<string, TVisitState>();
  const order: string[] = [];
  const stack: string[] = [];

  function visit(pluginId: string): void {
    const currentState = state.get(pluginId);
    if (currentState === "visited") return;
    if (currentState === "visiting") {
      const cycleStart = stack.indexOf(pluginId);
      throw new PluginCycleError([...stack.slice(cycleStart), pluginId]);
    }

    const manifest = registry.get(pluginId);
    if (!manifest) throw new PluginNotFoundError(pluginId);

    state.set(pluginId, "visiting");
    stack.push(pluginId);

    for (const dependencyId of manifest.dependsOn) {
      visit(dependencyId);
    }

    stack.pop();
    state.set(pluginId, "visited");
    order.push(pluginId);
  }

  for (const pluginId of requestedIds) {
    visit(pluginId);
  }

  return order;
}

/**
 * Among `installedIds`, returns those that transitively depend on `targetId` — i.e. plugins that
 * would be left with a missing dependency if `targetId` were removed. A candidate whose own
 * dependency closure can't be resolved (e.g. it references a plugin id no longer in the registry)
 * is skipped rather than failing the whole check; that drift is `plugin-doctor`'s concern.
 */
export function findReverseDependents(registry: TPluginRegistryMap, installedIds: string[], targetId: string): string[] {
  const dependents: string[] = [];

  for (const candidateId of installedIds) {
    if (candidateId === targetId) continue;

    let closure: string[];
    try {
      closure = resolveInstallOrder(registry, [candidateId]);
    } catch {
      continue;
    }

    if (closure.includes(targetId)) {
      dependents.push(candidateId);
    }
  }

  return dependents;
}
