import { useEffect, useRef } from "react";

export type TJobStep = { key: string; label: string; status: "pending" | "running" | "success" | "failed" | "skipped"; detail?: string };

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

/** Folds an incoming `job-step` event's steps into a running list, keyed by `step.key` (later updates for the same key replace earlier ones, in place). */
export function mergeJobSteps(prev: TJobStep[], incoming: TJobStep[]): TJobStep[] {
  const map = new Map(prev.map((step) => [step.key, step]));
  for (const step of incoming) map.set(step.key, step);
  return Array.from(map.values());
}

/** Subscribes to Tool Studio's job-progress SSE stream, filtered to one jobId. */
export function useJobEvents(jobId: string | undefined, onEvent: (event: TJobEvent) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!jobId || typeof window === "undefined" || !("EventSource" in window)) return;

    const source = new EventSource("/api/tool/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as TJobEvent;
        if (event.channel !== "job" || event.jobId !== jobId) return;
        handlerRef.current(event);
        // Self-close as soon as the job is done — callers never reset `jobId` back to `undefined`
        // after completion, so without this the connection would otherwise stay open for as long as
        // the component stays mounted (which, with Tool Studio's keep-alive nav, can be the rest of
        // the tab's life).
        if (event.type === "job-completed" || event.type === "job-failed") source.close();
      } catch {
        // ignore malformed events
      }
    };

    return () => source.close();
  }, [jobId]);
}
