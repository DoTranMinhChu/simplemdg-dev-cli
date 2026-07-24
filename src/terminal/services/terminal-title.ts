const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// xterm title-stack push/pop (`CSI 22;0 t` / `CSI 23;0 t`) — supported by
// Windows Terminal, most Linux terminals, iTerm2, and macOS Terminal. Using
// the stack instead of remembering the previous title avoids needing a
// portable "query current title" sequence, which doesn't exist.
const PUSH_TITLE_STACK = `${ESC}[22;0t`;
const POP_TITLE_STACK = `${ESC}[23;0t`;

function setTitleSequence(title: string): string {
  return `${ESC}]2;${title}${BEL}`;
}

function canWriteEscapeCodes(): boolean {
  return Boolean(process.stdout && process.stdout.isTTY);
}

let isPushed = false;

/** Pushes the terminal's current tab title onto its title stack, then sets a new one. No-ops on non-TTY output (CI, pipes) so nothing leaks into piped stdout. */
export function pushTerminalTitle(title: string): void {
  if (!canWriteEscapeCodes()) {
    return;
  }

  try {
    process.stdout.write(PUSH_TITLE_STACK + setTitleSequence(title));
    isPushed = true;
  } catch {
    // Best-effort — a terminal-chrome cosmetic must never break the shell.
  }
}

/** Restores whatever title was on top of the terminal's title stack before the matching `pushTerminalTitle` call. Safe to call even if nothing is currently pushed. */
export function popTerminalTitle(): void {
  if (!isPushed || !canWriteEscapeCodes()) {
    return;
  }

  try {
    process.stdout.write(POP_TITLE_STACK);
  } catch {
    // Best-effort — see above.
  } finally {
    isPushed = false;
  }
}

let exitRestoreInstalled = false;

/**
 * Backstop for the restore-on-exit case `popTerminalTitle()` alone can't
 * cover: a clean `process.exit()`/natural end of the event loop that skips
 * whatever explicit call site would otherwise have popped the title. Safe to
 * call multiple times; only the first call installs the listener. Mirrors
 * `terminal-crash-guard.ts`'s pattern, but that guard only fires on
 * uncaughtException/unhandledRejection — not on a normal exit — so this
 * needs its own hook.
 */
export function installTerminalTitleExitRestore(): void {
  if (exitRestoreInstalled) {
    return;
  }
  exitRestoreInstalled = true;

  process.on("exit", () => {
    popTerminalTitle();
  });
}
