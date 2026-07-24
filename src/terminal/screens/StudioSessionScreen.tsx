import React, { useEffect } from "react";
import { StreamingOutputScreen } from "../components/StreamingOutputScreen";
import { onJobEvent, type TJobEvent } from "../../core/tool/studio/job-events";
import type { StreamingSessionService } from "../services/streaming-session-service";

type TStudioHandle = { url: string; port: number; close: () => Promise<void> };

function describeJobEvent(event: TJobEvent): { text: string; stream?: "stderr" } | undefined {
  switch (event.type) {
    case "job-started":
      return { text: "job started" };
    case "job-log":
      return event.log ? { text: event.log } : undefined;
    case "job-step": {
      const active = event.steps?.find((step) => step.status === "running") ?? event.steps?.[event.steps.length - 1];
      if (!active) return undefined;
      return { text: `[${active.status}] ${active.label}${active.detail ? ` — ${active.detail}` : ""}` };
    }
    case "job-completed":
      return { text: "job completed" };
    case "job-failed":
      return { text: `job failed: ${event.error ?? "unknown error"}`, stream: "stderr" };
    default:
      return undefined;
  }
}

/**
 * Shared shape for every "Studio" command (AI/Tool/DB/Proxy Studio): each is
 * a local `node:http` server + browser tab, not a terminal program, so this
 * session is a background-status view rather than an attempt to render the
 * React app in-terminal — start the server, report its URL, relay Tool
 * Studio's job-event bus (the same data its browser tab gets over SSE) into
 * this session's live buffer when available, and close the server when the
 * session ends. The actual interactive work stays in the browser tab.
 */
// Every session's underlying server must start exactly ONCE for that
// session's entire lifetime, no matter how many times its screen mounts —
// see the comment inside the effect below for why this can't be a plain
// per-component `useRef` guard.
const startedSessions = new WeakSet<StreamingSessionService>();

export function makeStudioSessionScreen(config: {
  title: string;
  /**
   * Receives an `onLog` sink instead of taking no arguments — the underlying
   * `startXStudioServer()` functions print their own startup status lines
   * (URL, read-only/api-only notices, etc.), and those must be routed through
   * this session's managed buffer instead of `console.log`. Calling
   * `console.log` directly while Ink is independently redrawing the same
   * real terminal corrupts the display — this was a real, reported bug (raw
   * "SimpleMDG AI Studio: ..." lines and Node's own process warnings landing
   * mid-frame, outside any managed session view).
   */
  startServer: (onLog: (message: string) => void) => Promise<TStudioHandle>;
  relayJobEvents?: boolean;
}): React.ComponentType<{ service: StreamingSessionService; onDone: (success: boolean) => void; maxVisibleRows?: number }> {
  return function StudioSessionScreen(props) {
    const { service } = props;

    useEffect(() => {
      // `TerminalRouter` only renders whichever session is currently
      // FOCUSED — switching focus away unmounts this screen entirely, and
      // switching back mounts a brand-new component instance. A per-instance
      // `useRef` guard doesn't survive that remount, so without this
      // module-level, service-keyed guard, every focus switch back to this
      // session would call `startServer()` again — spawning a whole new dev
      // server (new port) while the previous one leaked, running forever in
      // the background. `service` itself persists for the session's entire
      // lifetime (held by useSessionRegistry), so keying on it is what
      // survives the remount. The service's own buffer already holds all
      // prior output and keeps accumulating via `onJobEvent` below while
      // unmounted, so remounting has nothing left to do but redisplay it.
      if (startedSessions.has(service)) {
        return;
      }
      startedSessions.add(service);

      let closeHandle: (() => Promise<void>) | undefined;
      let abortedBeforeReady = false;

      const closeAndStop = () => {
        void closeHandle?.().then(() => service.setStatus(service.status === "failed" ? "failed" : "stopped"));
      };

      // Tied to the session's own AbortSignal (fired on user-initiated
      // cancel or shell exit), not to this component's unmount — a focus
      // switch must never tear any of this down.
      service.signal.addEventListener(
        "abort",
        () => {
          if (closeHandle) {
            closeAndStop();
          } else {
            abortedBeforeReady = true;
          }
        },
        { once: true },
      );

      void (async () => {
        try {
          service.write(`Starting ${config.title}...`);
          const handle = await config.startServer((message) => service.write(message));
          closeHandle = handle.close;

          if (abortedBeforeReady) {
            closeAndStop();
            return;
          }

          service.write("Opened in your default browser. This session keeps running in the background — switch away any time.");

          if (config.relayJobEvents) {
            const unsubscribeJobs = onJobEvent((event) => {
              const described = describeJobEvent(event);
              if (described) {
                service.write(described.text, { tag: event.jobId.slice(0, 8), stream: described.stream });
              }
            });
            service.signal.addEventListener("abort", () => unsubscribeJobs(), { once: true });
          }
        } catch (error) {
          service.write(error instanceof Error ? error.message : String(error), { stream: "stderr" });
          service.setStatus("failed");
        }
      })();
    }, [service]);

    return <StreamingOutputScreen service={props.service} title={config.title} onDone={props.onDone} maxVisibleRows={props.maxVisibleRows} />;
  };
}
