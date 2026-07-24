import React, { useEffect, useRef } from "react";
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
export function makeStudioSessionScreen(config: {
  title: string;
  startServer: () => Promise<TStudioHandle>;
  relayJobEvents?: boolean;
}): React.ComponentType<{ service: StreamingSessionService; onDone: (success: boolean) => void; maxVisibleRows?: number }> {
  return function StudioSessionScreen(props) {
    const startedRef = useRef(false);

    useEffect(() => {
      if (startedRef.current) {
        return;
      }
      startedRef.current = true;

      let closeHandle: (() => Promise<void>) | undefined;
      let abortedBeforeReady = false;
      let unsubscribeJobs: (() => void) | undefined;

      const closeAndStop = () => {
        void closeHandle?.().then(() => props.service.setStatus(props.service.status === "failed" ? "failed" : "stopped"));
      };

      const onAbort = () => {
        if (closeHandle) {
          closeAndStop();
        } else {
          abortedBeforeReady = true;
        }
      };
      props.service.signal.addEventListener("abort", onAbort, { once: true });

      void (async () => {
        try {
          props.service.write(`Starting ${config.title}...`);
          const handle = await config.startServer();
          closeHandle = handle.close;

          if (abortedBeforeReady) {
            closeAndStop();
            return;
          }

          props.service.write(`${config.title} ready: ${handle.url}`);
          props.service.write("Opened in your default browser. This session keeps running in the background — switch away any time.");

          if (config.relayJobEvents) {
            unsubscribeJobs = onJobEvent((event) => {
              const described = describeJobEvent(event);
              if (described) {
                props.service.write(described.text, { tag: event.jobId.slice(0, 8), stream: described.stream });
              }
            });
          }
        } catch (error) {
          props.service.write(error instanceof Error ? error.message : String(error), { stream: "stderr" });
          props.service.setStatus("failed");
        }
      })();

      return () => {
        unsubscribeJobs?.();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <StreamingOutputScreen service={props.service} title={config.title} onDone={props.onDone} maxVisibleRows={props.maxVisibleRows} />;
  };
}
