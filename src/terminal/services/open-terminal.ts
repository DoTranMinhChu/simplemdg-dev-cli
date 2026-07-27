import { execa } from "execa";
import { isCommandAvailable } from "../../core/tooling";

export type TOpenTerminalCommand = {
  workingDirectory: string;
  executable: string;
  args: string[];
  /** Extra environment variables set in the new terminal before running the command (e.g. an isolated CF_HOME). */
  env?: Record<string, string>;
};

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function appleScriptQuote(value: string): string {
  return `\\"${value.replace(/"/g, '\\\\"')}\\"`;
}

function buildPowerShellInlineCommand(command: TOpenTerminalCommand): string {
  const envLines = Object.entries(command.env ?? {}).map(([key, value]) => `$env:${key} = ${quotePowerShellString(value)}`);
  const quotedArgs = command.args.map((arg) => quotePowerShellString(arg));
  const commandLine = [command.executable, ...quotedArgs].join(" ");
  return [...envLines, commandLine].join("; ");
}

function buildPosixEnvPrefix(env?: Record<string, string>): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${shellQuotePosix(value)}`)
    .join(" ");
}

/**
 * The same command as copy-pasteable text, for the caller to show as a fallback. Spawning a new,
 * visible GUI terminal window from a background Node server is inherently session-dependent on
 * Windows (confirmed: `wt.exe`/`powershell.exe` can report a clean exit with no window ever
 * appearing at all when the server process isn't attached to the interactive desktop the user is
 * looking at) — no auto-launch heuristic can be 100% reliable, so every caller gets this text
 * regardless of whether the launch itself reports success.
 */
export function buildManualCommandText(command: TOpenTerminalCommand): string {
  if (process.platform === "win32") return buildPowerShellInlineCommand(command);
  const envPrefix = buildPosixEnvPrefix(command.env);
  const commandLine = `${command.executable} ${command.args.map(shellQuotePosix).join(" ")}`;
  return envPrefix ? `${envPrefix} ${commandLine}` : commandLine;
}

/**
 * Opens a new, interactive terminal window running the given command, then returns immediately —
 * the launched process must stay interactive in that window, so this never waits for it or pipes
 * its stdio into our own process. Windows only for now (Windows Terminal > PowerShell > cmd);
 * macOS/Linux use a best-effort `open`/`x-terminal-emulator` fallback. Shared by AI Studio's
 * "resume in terminal" and Tool Studio's "connect via SSH". `manualCommand` is always populated
 * (success or failure) so the caller can offer a copy-pasteable fallback either way.
 */
export async function openTerminalWithCommand(command: TOpenTerminalCommand): Promise<{ ok: boolean; error?: string; manualCommand: string }> {
  const cwd = command.workingDirectory;
  const manualCommand = buildManualCommandText(command);

  try {
    if (process.platform === "win32") {
      const inlineCommand = buildPowerShellInlineCommand(command);
      if (await isCommandAvailable("wt")) {
        // `-w new` forces a brand-new window: without it, `wt.exe` hands the command off to
        // whichever Windows Terminal window/monarch process is already running (as a new tab), so
        // if that window is minimized or on another desktop, the caller sees nothing happen at all.
        await execa("wt.exe", ["-w", "new", "-d", cwd, "powershell.exe", "-NoExit", "-Command", inlineCommand], { detached: true, stdio: "ignore" });
        return { ok: true, manualCommand };
      }
      // `cmd /c start` (not a direct powershell.exe spawn) is the reliable way to force a brand-new
      // console window on Windows — a plain detached spawn with stdio:"ignore" does not reliably
      // allocate a visible window at all, depending on the parent's own console/session state.
      await execa("cmd.exe", ["/c", "start", '""', "powershell.exe", "-NoExit", "-Command", inlineCommand], { cwd, detached: true, stdio: "ignore" });
      return { ok: true, manualCommand };
    }

    if (process.platform === "darwin") {
      const envPrefix = buildPosixEnvPrefix(command.env);
      const commandLine = `${envPrefix ? `${envPrefix} ` : ""}${command.executable} ${command.args.map(shellQuotePosix).join(" ")}`;
      const script = `tell application "Terminal" to do script "cd ${appleScriptQuote(cwd)} && ${commandLine}"`;
      await execa("osascript", ["-e", script], { detached: true, stdio: "ignore" });
      return { ok: true, manualCommand };
    }

    // Linux: no universal terminal launcher; try the most common one and report clearly if absent.
    if (await isCommandAvailable("x-terminal-emulator")) {
      const envPrefix = buildPosixEnvPrefix(command.env);
      const commandLine = `${envPrefix ? `${envPrefix} ` : ""}${command.executable} ${command.args.map(shellQuotePosix).join(" ")}`;
      await execa("x-terminal-emulator", ["-e", `bash -lc "cd ${shellQuotePosix(cwd)} && ${commandLine}; exec bash"`], {
        detached: true,
        stdio: "ignore",
      });
      return { ok: true, manualCommand };
    }

    return { ok: false, error: "No supported terminal launcher found on this Linux desktop (tried x-terminal-emulator).", manualCommand };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), manualCommand };
  }
}
