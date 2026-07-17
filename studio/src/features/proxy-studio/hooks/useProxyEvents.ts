import { useEffect, useRef } from "react";
import type { TProxyStatusEvent } from "../api/proxy-studio-api-client";

export type TProxyLogStreamEvent = { channel: "log"; envId: string; line: string };
export type TProxyStatusStreamEvent = TProxyStatusEvent & { channel: "status" };
export type TProxyStreamEvent = TProxyStatusStreamEvent | TProxyLogStreamEvent;

/** Subscribes to Proxy Studio's status+log SSE stream for the whole app's lifetime. */
export function useProxyEvents(onEvent: (event: TProxyStreamEvent) => void): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (typeof window === "undefined" || !("EventSource" in window)) return;

    const source = new EventSource("/api/proxy/events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as TProxyStreamEvent;
        handlerRef.current(event);
      } catch {
        // ignore malformed/keep-alive events
      }
    };

    return () => source.close();
  }, []);
}
