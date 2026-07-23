import type { ResultPromise } from "execa";

/**
 * In-memory registry of live `cf logs <app>` tails, keyed by job id — these are long-lived child
 * processes that never exit on their own (unlike `--recent`), so something has to be able to find
 * and kill one later: on an explicit "stop" click, on switching to tail a different app, or on the
 * Tool Studio server itself shutting down. Process-local and intentionally not persisted — a
 * restarted server has no tails to reattach to anyway.
 */
const registry = new Map<string, ResultPromise>();

export function registerTail(jobId: string, child: ResultPromise): void {
  registry.set(jobId, child);
}

/** Removes the registry entry without killing it — used once the process has already exited on its own. */
export function dropTail(jobId: string): void {
  registry.delete(jobId);
}

export function stopTail(jobId: string): boolean {
  const child = registry.get(jobId);
  if (!child) return false;
  registry.delete(jobId);
  child.kill();
  return true;
}

export function stopAllTails(): void {
  for (const [jobId, child] of registry) {
    child.kill();
    registry.delete(jobId);
  }
}
