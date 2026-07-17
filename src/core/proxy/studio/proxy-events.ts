import { EventEmitter } from "node:events";
import type { TProxyLogEvent, TProxyRuntimeStatus, TProxyStatusEvent, TProxyStatusEventStage } from "../proxy-types";

/**
 * Process-local event bus for Proxy Studio's status/log streaming — same shape as Tool
 * Studio's `job-events.ts`. Also keeps a per-env log ring buffer and latest-status snapshot
 * so a browser tab opened/reopened after the fact can still see scrollback instead of only
 * lines emitted after it subscribed.
 */
const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const STATUS_EVENT_NAME = "proxy-studio-status-event";
const LOG_EVENT_NAME = "proxy-studio-log-event";
const MAX_LOG_LINES_PER_ENV = 1000;

const logBuffers = new Map<string, string[]>();
const latestStatusByEnv = new Map<string, TProxyStatusEvent>();

function stageToStatus(stage: TProxyStatusEventStage): TProxyRuntimeStatus {
  if (stage === "api-attempt") return "authenticating";
  if (stage === "playwright-fallback") return "browser-auth";
  if (stage === "proxy-ready") return "ready";
  return stage;
}

export function emitProxyStage(envId: string, stage: TProxyStatusEventStage, message: string): void {
  const event: TProxyStatusEvent = {
    envId,
    stage,
    status: stageToStatus(stage),
    message,
    at: new Date().toISOString(),
  };
  latestStatusByEnv.set(envId, event);
  emitter.emit(STATUS_EVENT_NAME, event);
}

export function onProxyStatusEvent(listener: (event: TProxyStatusEvent) => void): () => void {
  emitter.on(STATUS_EVENT_NAME, listener);
  return () => emitter.off(STATUS_EVENT_NAME, listener);
}

export function getLatestProxyStatus(envId: string): TProxyStatusEvent | undefined {
  return latestStatusByEnv.get(envId);
}

export function appendProxyLog(envId: string, line: string): void {
  const buffer = logBuffers.get(envId) ?? [];
  buffer.push(line);
  if (buffer.length > MAX_LOG_LINES_PER_ENV) {
    buffer.shift();
  }
  logBuffers.set(envId, buffer);
  emitter.emit(LOG_EVENT_NAME, { envId, line } satisfies TProxyLogEvent);
}

export function onProxyLogEvent(listener: (event: TProxyLogEvent) => void): () => void {
  emitter.on(LOG_EVENT_NAME, listener);
  return () => emitter.off(LOG_EVENT_NAME, listener);
}

export function getProxyLogBuffer(envId: string): string[] {
  return logBuffers.get(envId) ?? [];
}

export function clearProxyLogBuffer(envId: string): void {
  logBuffers.delete(envId);
}
