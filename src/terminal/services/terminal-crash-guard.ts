import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

const CRASH_LOG_DIRECTORY = path.join(os.homedir(), ".simplemdg", "logs");
const ESCAPE_CHAR = String.fromCharCode(27);
const SHOW_CURSOR_SEQUENCE = ESCAPE_CHAR + "[?25h";

/** Forces the cursor visible and raw mode off regardless of whatever state Ink/prompts left behind. */
function restoreTerminalForCrash(): void {
  try {
    if (process.stdout.isTTY) {
      process.stdout.write(SHOW_CURSOR_SEQUENCE);
    }
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(false);
    }
  } catch {
    // Best-effort — a crash handler must never itself throw.
  }
}

function writeCrashReport(error: unknown): void {
  try {
    fs.ensureDirSync(CRASH_LOG_DIRECTORY);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = path.join(CRASH_LOG_DIRECTORY, "crash-" + timestamp + ".log");
    const details = error instanceof Error ? (error.stack ?? error.message) : String(error);
    fs.writeFileSync(logPath, new Date().toISOString() + "\n\n" + details + "\n");
    console.error("A crash report was saved to " + logPath);
  } catch {
    // Logging the crash must never itself throw or mask the original error.
  }
}

let installed = false;

/**
 * Installed once for the whole `smdg` process. Covers the class of bug behind the reported
 * "Mark this target as favorite?" crash: a synchronous exception thrown from inside a raw
 * 'keypress' event handler (e.g. a third-party prompt library indexing into `undefined`) is
 * not something any `try`/`catch` around an `await` can ever catch — it surfaces here or not
 * at all. Without this handler, Node's default behavior is to dump a raw stack trace and exit
 * with the cursor potentially left hidden and stdin left in raw mode.
 *
 * `context` only changes the printed message — `restoreTerminalForCrash()` already no-ops
 * outside a real TTY, so calling this from a plain (non-shell) `smdg <command>` invocation is
 * safe even when piped/CI. Idempotent: the interactive shell also calls this on launch, and the
 * second call here is a no-op (`installed` guard) rather than a duplicate handler.
 */
export function installTerminalCrashGuard(context: "shell" | "cli" = "shell"): void {
  if (installed) return;
  installed = true;

  const message =
    context === "shell"
      ? "The SimpleMDG Developer Console hit an unexpected error and needs to close."
      : "smdg hit an unexpected error and had to stop.";

  const handleFatal = (error: unknown) => {
    restoreTerminalForCrash();
    console.error("");
    console.error(message);
    writeCrashReport(error);
    process.exit(1);
  };

  process.on("uncaughtException", handleFatal);
  process.on("unhandledRejection", handleFatal);
}
