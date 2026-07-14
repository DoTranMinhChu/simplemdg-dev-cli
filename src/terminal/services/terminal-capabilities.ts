/**
 * Single gate deciding whether `smdg`/`smdg shell` may launch the Ink shell at
 * all, and whether widgets render Unicode glyphs or an ASCII fallback.
 * Non-TTY/CI/NO_COLOR environments must fall back to today's plain behavior.
 */
export type TTerminalCapabilities = {
  isTTY: boolean;
  isCI: boolean;
  noColor: boolean;
  supportsUnicode: boolean;
  columns: number;
  rows: number;
};

function detectCI(): boolean {
  return Boolean(process.env.CI) || Boolean(process.env.CONTINUOUS_INTEGRATION) || Boolean(process.env.BUILD_NUMBER);
}

function detectNoColor(): boolean {
  // Respect NO_COLOR (https://no-color.org) regardless of value/emptiness.
  return process.env.NO_COLOR !== undefined;
}

function detectUnicodeSupport(): boolean {
  if (process.env.SMDG_FORCE_ASCII === "1") {
    return false;
  }

  if (process.platform !== "win32") {
    return true;
  }

  // Modern Windows terminals (Windows Terminal, VS Code integrated terminal,
  // ConEmu/Cmder) set one of these markers and render Unicode box-drawing and
  // symbol glyphs reliably. Legacy conhost.exe / Windows PowerShell 5.1 hosts
  // do not set any of them and are safer defaulted to ASCII.
  return Boolean(process.env.WT_SESSION || process.env.TERM_PROGRAM || process.env.ConEmuPID);
}

export function detectTerminalCapabilities(): TTerminalCapabilities {
  const isTTY = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);

  return {
    isTTY,
    isCI: detectCI(),
    noColor: detectNoColor(),
    supportsUnicode: detectUnicodeSupport(),
    columns: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
  };
}

/** Whether `smdg`/`smdg shell` should launch the Ink shell, or fall back to today's plain behavior. */
export function canLaunchInteractiveShell(capabilities: TTerminalCapabilities): boolean {
  return capabilities.isTTY && !capabilities.isCI;
}
