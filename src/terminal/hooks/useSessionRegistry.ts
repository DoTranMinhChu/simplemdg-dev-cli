import { randomUUID } from "node:crypto";
import { useCallback, useRef, useState } from "react";
import { InkInteractionService } from "../services/ink-interaction-service";
import { StreamingSessionService } from "../services/streaming-session-service";
import type { TNotification } from "../../core/interaction/interaction-service";
import type { TInteractiveCommandDefinition } from "../services/command-registry";

export type TSessionStatus = "running" | "done" | "failed" | "cancelled";

type TSessionBase = {
  id: string;
  commandId: string;
  label: string;
  controller: AbortController;
  status: TSessionStatus;
  createdAt: number;
};

/** A modal-interaction native command (`git move-code`, `cf org`, …) — one InkInteractionService + InteractionHost. */
export type TWorkflowSession = TSessionBase & { kind: "workflow"; service: InkInteractionService };

/** A long-running/tailing command (log follow, HTTP watch, dev server, …) — one StreamingSessionService + StreamingOutputScreen. */
export type TStreamingSession = TSessionBase & { kind: "streaming"; service: StreamingSessionService };

export type TSession = TWorkflowSession | TStreamingSession;

// Studio commands are singleton local dev servers with no parameters — unlike
// e.g. `cf logs` (where launching twice legitimately tails two different
// apps), running two AI Studio servers at once is never intentional and just
// clutters the switcher with duplicates. See `launchStreaming` below.
const SINGLETON_COMMAND_IDS = new Set(["ai.studio", "tool.studio", "cf.db.studio", "proxy.studio"]);

/**
 * Replaces the shell's old single `route`/`activeService`/`useCancellation`
 * trio — that combination hard-assumed exactly one workflow could ever run
 * (a second `launch` would silently orphan the first). This tracks an
 * ordered list of concurrent sessions plus which one (if any) is focused;
 * `undefined` focus means the home screen is showing.
 */
export function useSessionRegistry(options: {
  onNotify: (notification: TNotification) => void;
  onNeedsFocusNotice: (session: TSession) => void;
}): {
  sessions: TSession[];
  focusedSession: TSession | undefined;
  launchWorkflow: (command: TInteractiveCommandDefinition) => TWorkflowSession;
  launchStreaming: (command: TInteractiveCommandDefinition) => TStreamingSession;
  finish: (sessionId: string, success: boolean) => void;
  focusHome: () => void;
  focusSession: (sessionId: string) => void;
  cancelFocused: () => boolean;
} {
  const [sessions, setSessions] = useState<TSession[]>([]);
  const [focusedSessionId, setFocusedSessionId] = useState<string | undefined>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Mirrors of the latest state, readable from callbacks/listeners without
  // going through another `setState` (which would either be stale inside a
  // closure or, if done via a setter's updater function purely to "peek" at
  // current state, an impure updater that StrictMode may invoke twice).
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const focusedSessionIdRef = useRef(focusedSessionId);
  focusedSessionIdRef.current = focusedSessionId;

  const launchWorkflow = useCallback((command: TInteractiveCommandDefinition): TWorkflowSession => {
    const controller = new AbortController();
    const service = new InkInteractionService(controller.signal);
    const session: TWorkflowSession = {
      id: randomUUID(),
      kind: "workflow",
      commandId: command.id,
      label: `/${command.path.join(" ")}`,
      controller,
      service,
      status: "running",
      createdAt: Date.now(),
    };

    service.on("notify", (notification: TNotification) => optionsRef.current.onNotify(notification));

    // A backgrounded session hitting a select/confirm/input/multiSelect call
    // has nowhere to render its modal — auto-focus it (with a notice) rather
    // than leaving it silently stuck forever.
    service.on("change", (pending) => {
      if (pending && focusedSessionIdRef.current !== session.id) {
        setFocusedSessionId(session.id);
        optionsRef.current.onNeedsFocusNotice(session);
      }
    });

    setSessions((current) => [...current, session]);
    setFocusedSessionId(session.id);
    return session;
  }, []);

  const launchStreaming = useCallback((command: TInteractiveCommandDefinition): TStreamingSession => {
    if (SINGLETON_COMMAND_IDS.has(command.id)) {
      const existing = sessionsRef.current.find(
        (entry): entry is TStreamingSession => entry.kind === "streaming" && entry.commandId === command.id,
      );
      if (existing) {
        setFocusedSessionId(existing.id);
        return existing;
      }
    }

    const controller = new AbortController();
    const service = new StreamingSessionService(controller.signal);
    const session: TStreamingSession = {
      id: randomUUID(),
      kind: "streaming",
      commandId: command.id,
      label: `/${command.path.join(" ")}`,
      controller,
      service,
      status: "running",
      createdAt: Date.now(),
    };

    setSessions((current) => [...current, session]);
    setFocusedSessionId(session.id);
    return session;
  }, []);

  const finish = useCallback((sessionId: string, _success: boolean) => {
    setSessions((current) => {
      const session = current.find((entry) => entry.id === sessionId);
      if (session?.kind === "streaming") {
        session.service.stop();
      }
      session?.service.removeAllListeners();
      return current.filter((entry) => entry.id !== sessionId);
    });
    setFocusedSessionId((current) => (current === sessionId ? undefined : current));
  }, []);

  const focusHome = useCallback(() => setFocusedSessionId(undefined), []);
  const focusSession = useCallback((sessionId: string) => setFocusedSessionId(sessionId), []);

  const cancelFocused = useCallback((): boolean => {
    const session = sessionsRef.current.find((entry) => entry.id === focusedSessionIdRef.current);
    if (!session || session.controller.signal.aborted) {
      return false;
    }
    session.controller.abort();
    return true;
  }, []);

  return {
    sessions,
    focusedSession: sessions.find((session) => session.id === focusedSessionId),
    launchWorkflow,
    launchStreaming,
    finish,
    focusHome,
    focusSession,
    cancelFocused,
  };
}
