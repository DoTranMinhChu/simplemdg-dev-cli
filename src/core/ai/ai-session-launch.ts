import { isCommandAvailable } from "../tooling";
import { checkWorkingDirectory, type TAiSessionLaunchCommand, type TShellKind } from "./ai-session-command-service";
import { getSessionLauncher } from "./launchers/claude-session-launcher";
import type { TAiSession } from "./ai-types";

export type TAiSessionLaunchResponse = {
  provider: TAiSession["provider"];
  canResume: boolean;
  reason?: string;
  workingDirectory: string;
  workingDirectoryExists: boolean;
  commands?: {
    resume: TAiSessionLaunchCommand;
    resumeWithWorkingDirectory: TAiSessionLaunchCommand;
    continueLatestInProject: TAiSessionLaunchCommand;
  };
  capabilities: {
    copyCommand: boolean;
    openTerminal: boolean;
    openProject: boolean;
    openVsCode: boolean;
  };
};

/**
 * Provider-gated launch info for a session: whether it can be resumed, the exact commands to show,
 * and which actions are safe to expose in the UI. Never invents a resume command for a provider
 * without a verified launcher (see claude-session-launcher.ts's getSessionLauncher).
 */
export async function buildSessionLaunchResponse(session: TAiSession, shell?: TShellKind): Promise<TAiSessionLaunchResponse> {
  const launcher = getSessionLauncher(session.provider);
  const [dir, vsCodeAvailable] = await Promise.all([checkWorkingDirectory(session.cwd), isCommandAvailable("code")]);

  if (!launcher) {
    return {
      provider: session.provider,
      canResume: false,
      reason: `Resuming ${session.provider} sessions is not supported yet (no verified resume command for this provider).`,
      workingDirectory: session.cwd,
      workingDirectoryExists: dir.exists,
      capabilities: { copyCommand: false, openTerminal: false, openProject: dir.exists, openVsCode: dir.exists && vsCodeAvailable },
    };
  }

  const capability = await launcher.canResume(session);
  const commands = capability.canResume
    ? {
        resume: launcher.buildResumeCommand(session, { shell, includeChangeDirectory: false }),
        resumeWithWorkingDirectory: launcher.buildResumeCommand(session, { shell, includeChangeDirectory: true }),
        continueLatestInProject: launcher.buildContinueCommand(session, { shell, includeChangeDirectory: true }),
      }
    : undefined;

  return {
    provider: session.provider,
    canResume: capability.canResume,
    reason: capability.reason,
    workingDirectory: session.cwd,
    workingDirectoryExists: dir.exists,
    commands,
    capabilities: {
      copyCommand: capability.canResume,
      openTerminal: capability.canResume,
      openProject: dir.exists,
      openVsCode: dir.exists && vsCodeAvailable,
    },
  };
}
