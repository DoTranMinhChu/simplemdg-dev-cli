import { useState } from "react";
import { aiStudioApi } from "../../api/ai-studio-api-client";
import { shouldSkipLaunchConfirm } from "./launch-confirm";
import type { TAiSession, TAiSessionLaunchCommand } from "../../api/ai-studio-api-types";

export type TPendingLaunch = { title: string; launch: TAiSessionLaunchCommand; sessionId: string; mode: "resume" | "continue" };

type TToastFn = (message: string, kind?: "ok" | "err" | "warn") => void;

/**
 * Shared "resume/continue, with a confirm dialog unless the user opted out" flow. Used by the
 * workspace quick actions, the session list's row actions, and the Continue Working widget — one
 * flow, three entry points, so the confirm/skip behavior can't drift between them.
 */
export function useSessionResume(toast: TToastFn): {
  pending: TPendingLaunch | undefined;
  requestLaunch: (session: TAiSession, mode: "resume" | "continue") => Promise<void>;
  confirmPending: () => void;
  cancelPending: () => void;
} {
  const [pending, setPending] = useState<TPendingLaunch | undefined>();

  const launchNow = async (sessionId: string, mode: "resume" | "continue"): Promise<void> => {
    const result = await aiStudioApi.openTerminal(sessionId, mode);
    if (!result.ok) toast(result.error ?? "Failed to open a terminal.", "err");
    else toast(mode === "resume" ? "Opened a new terminal, resuming this session." : "Opened a new terminal, continuing the latest session in this project.");
  };

  const requestLaunch = async (session: TAiSession, mode: "resume" | "continue"): Promise<void> => {
    try {
      const launch = await aiStudioApi.getLaunch(session.id);
      if (mode === "resume" && !launch.canResume) {
        toast(launch.reason ?? "This session cannot be resumed.", "err");
        return;
      }
      if (!launch.commands) return;
      const command = mode === "resume" ? launch.commands.resume : launch.commands.continueLatestInProject;
      if (shouldSkipLaunchConfirm()) {
        await launchNow(session.id, mode);
        return;
      }
      setPending({
        title: mode === "resume" ? "Resume in Claude Code" : "Continue latest session in this project",
        launch: command,
        sessionId: session.id,
        mode,
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  const confirmPending = (): void => {
    if (!pending) return;
    const { sessionId, mode } = pending;
    setPending(undefined);
    launchNow(sessionId, mode);
  };

  return { pending, requestLaunch, confirmPending, cancelPending: () => setPending(undefined) };
}
