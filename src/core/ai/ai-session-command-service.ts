import path from "node:path";
import fs from "fs-extra";
import { execa } from "execa";
import { isCommandAvailable } from "../tooling";
import { openTerminalWithCommand as openTerminalWithCommandGeneric } from "../../terminal/services/open-terminal";
import type { TAiSession } from "./ai-types";

export type TShellKind = "powershell" | "cmd" | "bash" | "zsh" | "unknown";

export type TBuildResumeCommandOptions = {
  shell?: TShellKind;
  includeChangeDirectory?: boolean;
  preferSessionName?: boolean;
  /** Extra `claude` CLI argv tokens appended after the resume/continue flag (e.g.
   *  `["--dangerously-skip-permissions"]` or `["--model", "sonnet"]`) — see resume-flags.ts on the
   *  Studio frontend for the curated picker that produces these. Appended as literal argv entries,
   *  never through a shell, so arbitrary token content here can't cause injection. */
  extraArgs?: string[];
};

export type TAiSessionLaunchCommand = {
  provider: "claude";
  sessionId: string;
  sessionName?: string;
  workingDirectory: string;
  command: string;
  executable: string;
  args: string[];
  shell: TShellKind;
};

/** Extracts the bare Claude session id from our internal id (`claude:<uuid>` or `claude:<uuid>:agent:<agentId>`). */
export function claudeRawSessionId(session: TAiSession): string {
  const parts = session.id.split(":");
  return parts[1] ?? session.id;
}

export function detectDefaultShell(): TShellKind {
  if (process.platform === "win32") return "powershell";
  const shellPath = process.env.SHELL ?? "";
  if (shellPath.includes("zsh")) return "zsh";
  if (shellPath.includes("bash")) return "bash";
  return process.platform === "darwin" ? "zsh" : "bash";
}

/** Wraps a value for safe interpolation into a *displayed* (copy-to-clipboard) shell command line. Never used for actual process spawning — those always use argument arrays. */
function quoteForShell(value: string, shell: TShellKind): string {
  if (shell === "powershell") return `'${value.replace(/'/g, "''")}'`;
  if (shell === "cmd") return `"${value.replace(/"/g, '""')}"`;
  // bash/zsh/unknown: single-quote, escaping embedded single quotes the POSIX-safe way.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Only quotes a display token when it actually needs it (contains whitespace/quotes) — flag names
 *  like `--verbose` read a lot cleaner bare than as `'--verbose'`, and it's purely cosmetic since the
 *  real spawn always goes through the argv array in `args`, never this string. */
function quoteForShellIfNeeded(value: string, shell: TShellKind): string {
  return /[\s'"]/.test(value) ? quoteForShell(value, shell) : value;
}

function changeDirectoryLine(workingDirectory: string, shell: TShellKind): string {
  if (shell === "powershell") return `Set-Location ${quoteForShell(workingDirectory, shell)}`;
  if (shell === "cmd") return `cd /d ${quoteForShell(workingDirectory, shell)}`;
  return `cd ${quoteForShell(workingDirectory, shell)}`;
}

function joinLines(lines: string[], shell: TShellKind): string {
  if (shell === "bash" || shell === "zsh") return lines.join(" && \\\n");
  return lines.join("\n");
}

/**
 * `preferSessionName` is accepted for API-shape completeness (per the original design) but is
 * deliberately never used to change the resume target: verified against the installed `claude`
 * CLI (`claude --help`), `-r, --resume [value]` only resumes deterministically when `value` is an
 * exact session ID — passing any other string (like a title) just opens Claude's own interactive
 * picker pre-filtered by that text, not a silent named resume. Since our whole point is a
 * one-click, exact resume, we always resume by the real session ID and show the title only as
 * display text, never as the `--resume` argument.
 */
export function buildResumeCommand(session: TAiSession, options: TBuildResumeCommandOptions = {}): TAiSessionLaunchCommand {
  const shell = options.shell ?? detectDefaultShell();
  const rawSessionId = claudeRawSessionId(session);
  const identifier = rawSessionId;
  const extraArgs = options.extraArgs ?? [];
  void options.preferSessionName;

  const args = ["--resume", identifier, ...extraArgs];
  const commandLine = [`claude --resume ${quoteForShell(identifier, shell)}`, ...extraArgs.map((arg) => quoteForShellIfNeeded(arg, shell))].join(" ");
  const lines = options.includeChangeDirectory ? [changeDirectoryLine(session.cwd, shell), commandLine] : [commandLine];

  return {
    provider: "claude",
    sessionId: rawSessionId,
    sessionName: session.title || undefined,
    workingDirectory: session.cwd,
    command: joinLines(lines, shell),
    executable: "claude",
    args,
    shell,
  };
}

export function buildContinueCommand(session: TAiSession, options: TBuildResumeCommandOptions = {}): TAiSessionLaunchCommand {
  const shell = options.shell ?? detectDefaultShell();
  const extraArgs = options.extraArgs ?? [];
  const commandLine = ["claude --continue", ...extraArgs.map((arg) => quoteForShellIfNeeded(arg, shell))].join(" ");
  const lines = options.includeChangeDirectory !== false ? [changeDirectoryLine(session.cwd, shell), commandLine] : [commandLine];

  return {
    provider: "claude",
    sessionId: claudeRawSessionId(session),
    workingDirectory: session.cwd,
    command: joinLines(lines, shell),
    executable: "claude",
    args: ["--continue", ...extraArgs],
    shell,
  };
}

export type TPathCheckResult = { exists: boolean; isDirectory: boolean };

export async function checkWorkingDirectory(workingDirectory: string): Promise<TPathCheckResult> {
  try {
    const stat = await fs.stat(workingDirectory);
    return { exists: true, isDirectory: stat.isDirectory() };
  } catch {
    return { exists: false, isDirectory: false };
  }
}

export async function isClaudeCliAvailable(): Promise<boolean> {
  return isCommandAvailable("claude");
}

/**
 * Opens a new, interactive terminal window running the resume/continue command, then returns
 * immediately — Claude Code must stay interactive in that window, so this never waits for it or
 * pipes its stdio into our own process. Thin AI-Studio-specific wrapper around the shared
 * cross-platform terminal launcher (see terminal/services/open-terminal.ts).
 */
export async function openTerminalWithCommand(launch: TAiSessionLaunchCommand): Promise<{ ok: boolean; error?: string }> {
  return openTerminalWithCommandGeneric({ workingDirectory: launch.workingDirectory, executable: launch.executable, args: launch.args });
}

export async function openProjectFolder(workingDirectory: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (process.platform === "win32") {
      await execa("explorer.exe", [workingDirectory], { reject: false });
      return { ok: true };
    }
    if (process.platform === "darwin") {
      await execa("open", [workingDirectory]);
      return { ok: true };
    }
    await execa("xdg-open", [workingDirectory]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function openProjectInVsCode(workingDirectory: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await isCommandAvailable("code"))) {
    return { ok: false, error: "VS Code command-line launcher ('code') was not found on PATH." };
  }
  try {
    await execa("code", [workingDirectory], { detached: true, stdio: "ignore" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Opens a specific file (optionally at a line) in VS Code — the click target for file-reference
 * links inside rendered chat markdown (`[file.ts:42](src/file.ts#L42)`), which otherwise resolve
 * as a plain relative `<a href>` against AI Studio's own local server and go nowhere useful.
 * `filePath` is resolved against `workingDirectory` (the session's cwd) unless already absolute.
 */
export async function openFileInVsCode(workingDirectory: string, filePath: string, line?: number): Promise<{ ok: boolean; error?: string }> {
  if (!(await isCommandAvailable("code"))) {
    return { ok: false, error: "VS Code command-line launcher ('code') was not found on PATH." };
  }
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workingDirectory, filePath);
  // VS Code's `--goto` correctly parses a Windows drive letter's colon vs. the trailing
  // `:line` — this is the CLI's own documented `file:line[:character]` syntax, not a raw path.
  const target = line ? `${absolutePath}:${line}` : absolutePath;
  try {
    await execa("code", ["--goto", target], { detached: true, stdio: "ignore" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function projectDirName(workingDirectory: string): string {
  return path.basename(workingDirectory) || workingDirectory;
}
