import { EventEmitter } from "node:events";
import type { TCacheEvent } from "./smart-cache.types";

/**
 * Process-local event bus for Smart Cache background refreshes. The DB Studio
 * server subscribes to this and forwards events to the browser over SSE.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const EVENT_NAME = "cache-event";

export function emitCacheEvent(event: TCacheEvent): void {
  emitter.emit(EVENT_NAME, event);
}

export function onCacheEvent(listener: (event: TCacheEvent) => void): () => void {
  emitter.on(EVENT_NAME, listener);
  return () => emitter.off(EVENT_NAME, listener);
}
