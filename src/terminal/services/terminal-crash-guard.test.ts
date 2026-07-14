import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installTerminalCrashGuard } from "./terminal-crash-guard";

const CRASH_LOG_DIRECTORY = path.join(os.homedir(), ".simplemdg", "logs");

describe("installTerminalCrashGuard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the cursor, disables raw mode, writes a crash log, and exits — without ever throwing itself", () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const setRawModeSpy = vi.fn();
    const originalIsTTY = process.stdout.isTTY;
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalSetRawMode = process.stdin.setRawMode;

    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdin as any).setRawMode = setRawModeSpy;

    vi.spyOn(console, "error").mockImplementation(() => undefined);

    installTerminalCrashGuard();
    // installTerminalCrashGuard() is idempotent (module-level `installed` guard) — calling it
    // again anywhere else in the process during this test run must not register a second handler.
    installTerminalCrashGuard();

    const handlers = process.listeners("uncaughtException");
    const ourHandler = handlers[handlers.length - 1] as (error: unknown) => void;

    expect(() => ourHandler(new Error("simulated crash for test"))).not.toThrow();

    expect(stdoutWriteSpy).toHaveBeenCalledWith(expect.stringContaining("[?25h"));
    expect(setRawModeSpy).toHaveBeenCalledWith(false);
    expect(exitSpy).toHaveBeenCalledWith(1);

    const crashFiles = fs.existsSync(CRASH_LOG_DIRECTORY) ? fs.readdirSync(CRASH_LOG_DIRECTORY) : [];
    const latestCrashFile = crashFiles.filter((name) => name.startsWith("crash-")).sort().pop();
    expect(latestCrashFile).toBeDefined();
    if (latestCrashFile) {
      const contents = fs.readFileSync(path.join(CRASH_LOG_DIRECTORY, latestCrashFile), "utf8");
      expect(contents).toContain("simulated crash for test");
      fs.removeSync(path.join(CRASH_LOG_DIRECTORY, latestCrashFile));
    }

    process.stdin.setRawMode = originalSetRawMode;
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinIsTTY, configurable: true });
    process.removeListener("uncaughtException", ourHandler);
  });
});
