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
 * Opens a new, interactive terminal window running the given command, then returns immediately —
 * the launched process must stay interactive in that window, so this never waits for it or pipes
 * its stdio into our own process. Windows only for now (Windows Terminal > PowerShell > cmd);
 * macOS/Linux use a best-effort `open`/`x-terminal-emulator` fallback. Shared by AI Studio's
 * "resume in terminal" and Tool Studio's "connect via SSH".
 */
export async function openTerminalWithCommand(command: TOpenTerminalCommand): Promise<{ ok: boolean; error?: string }> {
  const cwd = command.workingDirectory;

  try {
    if (process.platform === "win32") {
      const inlineCommand = buildPowerShellInlineCommand(command);
      if (await isCommandAvailable("wt")) {
        await execa("wt.exe", ["-d", cwd, "powershell.exe", "-NoExit", "-Command", inlineCommand], { detached: true, stdio: "ignore" });
        return { ok: true };
      }
      await execa("powershell.exe", ["-NoExit", "-Command", inlineCommand], { cwd, detached: true, stdio: "ignore" });
      return { ok: true };
    }

    if (process.platform === "darwin") {
      const envPrefix = buildPosixEnvPrefix(command.env);
      const commandLine = `${envPrefix ? `${envPrefix} ` : ""}${command.executable} ${command.args.map(shellQuotePosix).join(" ")}`;
      const script = `tell application "Terminal" to do script "cd ${appleScriptQuote(cwd)} && ${commandLine}"`;
      await execa("osascript", ["-e", script], { detached: true, stdio: "ignore" });
      return { ok: true };
    }

    // Linux: no universal terminal launcher; try the most common one and report clearly if absent.
    if (await isCommandAvailable("x-terminal-emulator")) {
      const envPrefix = buildPosixEnvPrefix(command.env);
      const commandLine = `${envPrefix ? `${envPrefix} ` : ""}${command.executable} ${command.args.map(shellQuotePosix).join(" ")}`;
      await execa("x-terminal-emulator", ["-e", `bash -lc "cd ${shellQuotePosix(cwd)} && ${commandLine}; exec bash"`], {
        detached: true,
        stdio: "ignore",
      });
      return { ok: true };
    }

    return { ok: false, error: "No supported terminal launcher found on this Linux desktop (tried x-terminal-emulator)." };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
