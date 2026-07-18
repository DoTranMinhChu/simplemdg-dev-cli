import {
  buildContinueCommand,
  buildResumeCommand,
  checkWorkingDirectory,
  isClaudeCliAvailable,
  openTerminalWithCommand,
  type TAiSessionLaunchCommand,
  type TBuildResumeCommandOptions,
} from "../ai-session-command-service";
import type { TAiSession } from "../ai-types";

export type TSessionLaunchCapability = {
  canResume: boolean;
  reason?: string;
};

export interface IAiSessionLauncher {
  readonly provider: "claude" | "codex" | "cursor" | "unknown";
  canResume(session: TAiSession): Promise<TSessionLaunchCapability>;
  buildResumeCommand(session: TAiSession, options?: TBuildResumeCommandOptions): TAiSessionLaunchCommand;
  openInTerminal(session: TAiSession, extraArgs?: string[]): Promise<{ ok: boolean; error?: string }>;
}

export class ClaudeSessionLauncher implements IAiSessionLauncher {
  readonly provider = "claude" as const;

  async canResume(session: TAiSession): Promise<TSessionLaunchCapability> {
    if (session.provider !== "claude") return { canResume: false, reason: "Not a Claude Code session." };

    const [claudeAvailable, dir] = await Promise.all([isClaudeCliAvailable(), checkWorkingDirectory(session.cwd)]);
    if (!claudeAvailable) return { canResume: false, reason: "The 'claude' CLI was not found on PATH." };
    if (!dir.exists) return { canResume: false, reason: "Project folder no longer exists." };
    if (!dir.isDirectory) return { canResume: false, reason: "Project path exists but is not a directory." };
    return { canResume: true };
  }

  buildResumeCommand(session: TAiSession, options?: TBuildResumeCommandOptions): TAiSessionLaunchCommand {
    return buildResumeCommand(session, options);
  }

  buildContinueCommand(session: TAiSession, options?: TBuildResumeCommandOptions): TAiSessionLaunchCommand {
    return buildContinueCommand(session, options);
  }

  async openInTerminal(session: TAiSession, extraArgs?: string[]): Promise<{ ok: boolean; error?: string }> {
    const capability = await this.canResume(session);
    if (!capability.canResume) return { ok: false, error: capability.reason };
    return openTerminalWithCommand(this.buildResumeCommand(session, { includeChangeDirectory: false, extraArgs }));
  }

  async openContinueInTerminal(session: TAiSession, extraArgs?: string[]): Promise<{ ok: boolean; error?: string }> {
    const dir = await checkWorkingDirectory(session.cwd);
    if (!dir.exists) return { ok: false, error: "Project folder no longer exists." };
    return openTerminalWithCommand(this.buildContinueCommand(session, { includeChangeDirectory: false, extraArgs }));
  }
}

/**
 * Provider-gated launcher registry — only Claude Code has a verified `--resume <sessionId>`
 * command today. Codex sessions get no launcher (no invented command); see
 * ai-studio-routes.ts's /launch route for how that's surfaced to the UI as "not yet supported".
 * Returns the concrete class (not just IAiSessionLauncher) since Claude has a couple of
 * provider-specific extras (buildContinueCommand/openContinueInTerminal) that aren't part of the
 * shared interface — opening a project folder / VS Code is provider-agnostic and handled directly
 * by ai-session-command-service instead of going through a launcher at all.
 */
export function getSessionLauncher(provider: string): ClaudeSessionLauncher | undefined {
  if (provider === "claude") return new ClaudeSessionLauncher();
  return undefined;
}
