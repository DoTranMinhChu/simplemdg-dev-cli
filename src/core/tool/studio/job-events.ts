import { EventEmitter } from "node:events";

/**
 * Process-local event bus for Tool Studio's long-running, step-by-step jobs
 * (MR creation, CDS scaffolding, ...) — distinct from smart-cache's
 * refresh-notification events (see smart-cache-events.ts). The Tool Studio
 * server multiplexes both kinds over one SSE connection, tagged by `channel`.
 */
export type TJobStep = {
  key: string;
  label: string;
  status: "pending" | "running" | "success" | "failed" | "skipped";
  detail?: string;
};

export type TJobEvent = {
  channel: "job";
  jobId: string;
  type: "job-started" | "job-step" | "job-log" | "job-completed" | "job-failed";
  steps?: TJobStep[];
  log?: string;
  error?: string;
  result?: unknown;
  updatedAt: string;
};

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const EVENT_NAME = "tool-studio-job-event";

export function emitJobEvent(event: Omit<TJobEvent, "channel" | "updatedAt">): void {
  emitter.emit(EVENT_NAME, { ...event, channel: "job", updatedAt: new Date().toISOString() } satisfies TJobEvent);
}

export function onJobEvent(listener: (event: TJobEvent) => void): () => void {
  emitter.on(EVENT_NAME, listener);
  return () => emitter.off(EVENT_NAME, listener);
}

/** Convenience: emit a single step update within a job's step list. */
export function emitJobStep(jobId: string, steps: TJobStep[]): void {
  emitJobEvent({ jobId, type: "job-step", steps });
}
