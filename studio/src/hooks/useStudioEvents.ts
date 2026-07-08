import { useEffect, useRef } from "react";
import type { TCacheEvent } from "../api/studio-api-types";

type TEventListener = (event: TCacheEvent) => void;

let sharedSource: EventSource | undefined;
const listeners = new Set<TEventListener>();
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function connect(): void {
  if (sharedSource || typeof window === "undefined" || !("EventSource" in window)) return;

  const source = new EventSource("/api/events");
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
