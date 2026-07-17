import { useEffect, useRef } from "react";
import type { TCacheEvent } from "../api/studio-api-types";

type TEventListener = (event: TCacheEvent) => void;

let sharedSource: EventSource | undefined;
const listeners = new Set<TEventListener>();
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * This hook (and the components that use it, e.g. BtpTargetSelector/BtpAppSelector) is shared
 * across studios that each run their OWN local HTTP server on their OWN port — DB Studio exposes
 * this stream at `/api/events`, Tool Studio at `/api/tool/events` (its `/api/events` doesn't exist
 * at all, which previously 404'd in an infinite reconnect loop whenever a BTP component was reused
 * there). Each studio's entry point (main.tsx/tool-main.tsx) stamps its own path onto `window`
 * before rendering, so a relative EventSource here always targets the server actually serving the
 * page — defaulting to DB Studio's path when unset, since that was this hook's original/only home.
 */
function eventsPath(): string {
  return (window as { __SMDG_STUDIO_EVENTS_PATH__?: string }).__SMDG_STUDIO_EVENTS_PATH__ ?? "/api/events";
}

function connect(): void {
  if (sharedSource || typeof window === "undefined" || !("EventSource" in window)) return;

  const source = new EventSource(eventsPath());
  sharedSource = source;

  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as TCacheEvent;
      listeners.forEach((listener) => listener(event));
    } catch {
      // ignore malformed events
    }
  };

  source.onerror = () => {
    source.close();
    sharedSource = undefined;
    reconnectTimer = setTimeout(connect, 6000);
  };
}

/**
 * Subscribe to the backend's cache-refresh SSE stream (`GET /api/events`).
 * A single shared EventSource is reused across every component that calls
 * this hook, with auto-reconnect on drop.
 */
export function useStudioEvents(onEvent: TEventListener): void {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const listener: TEventListener = (event) => handlerRef.current(event);
    listeners.add(listener);
    connect();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && sharedSource) {
        sharedSource.close();
        sharedSource = undefined;
        if (reconnectTimer) clearTimeout(reconnectTimer);
      }
    };
  }, []);
}
