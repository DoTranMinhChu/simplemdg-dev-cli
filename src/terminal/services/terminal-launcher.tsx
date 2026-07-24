import React from "react";
import readline from "node:readline";
import { execaSync } from "execa";
import { render } from "ink";
import type { Command } from "commander";
import { detectTerminalCapabilities, canLaunchInteractiveShell, type TTerminalCapabilities } from "./terminal-capabilities";
import { resolveTerminalTheme, type TTerminalTheme } from "./terminal-theme";
import { buildCommandRegistry, type TInteractiveCommandDefinition } from "./command-registry";
import { detectContextFacts, detectToolChecklist, type TToolCheck } from "./context-facts";
import { installTerminalCrashGuard } from "./terminal-crash-guard";
import { installTerminalTitleExitRestore, popTerminalTitle, pushTerminalTitle } from "./terminal-title";
import { loadCommandHistorySnapshot, type TCommandHistorySnapshot } from "./command-history";
import { readCache } from "../../core/cache";
import { runGroupNavigator } from "../../core/navigator";
import { SmdgTerminalApp } from "../app/SmdgTerminalApp";
import { TerminalContextProvider } from "../app/TerminalContext";
import type { TTerminalHeaderMode } from "../../core/types";

const SHELL_TERMINAL_TITLE = "smdg";

type TRenderOptions = {
  version: string;
  headerMode: TTerminalHeaderMode;
  theme: TTerminalTheme;
  capabilities: TTerminalCapabilities;
  registry: TInteractiveCommandDefinition[];
  projectName: string;
  branchName?: string;
  historySnapshot: TCommandHistorySnapshot;
  toolChecklist: TToolCheck[];
};

type TShellHandoff =
  | { kind: "external"; command: TInteractiveCommandDefinition }
  | { kind: "clear" }
  | { kind: "quit" };

/** Renders one shell instance until it hands off: a not-yet-migrated leaf was chosen (unmount so
 * external-process mode can take over), the user asked to clear the screen (unmount so the shell
 * can remount fully fresh — see the comment at the "clear" branch below for why a full remount is
 * required), or the user exited the shell entirely. */
function runShellUntilExternalProcessOrExit(options: TRenderOptions): Promise<TShellHandoff> {
  return new Promise((resolve) => {
    let settled = false;

    const instance = render(
      <TerminalContextProvider
        value={{
          theme: options.theme,
          capabilities: options.capabilities,
          registry: options.registry,
          projectName: options.projectName,
          branchName: options.branchName,
        }}
      >
        <SmdgTerminalApp
          version={options.version}
          headerMode={options.headerMode}
          historySnapshot={options.historySnapshot}
          toolChecklist={options.toolChecklist}
          onExternalProcessCommand={(command) => {
            if (settled) return;
            settled = true;
            instance.unmount();
            resolve({ kind: "external", command });
          }}
          onClearRequested={() => {
            if (settled) return;
            settled = true;
            instance.unmount();
            resolve({ kind: "clear" });
          }}
        />
      </TerminalContextProvider>,
      { exitOnCtrlC: false },
    );

    instance.waitUntilExit().then(() => {
      if (settled) return;
      settled = true;
      resolve({ kind: "quit" });
    });
  });
}

/**
 * Wipes the real terminal's visible screen AND scrollback. Ink's `<Static>`
 * commits are permanent and internally bookkept (it never re-renders
 * already-committed content, and tracks the cursor position that bookkeeping
 * implies) — clearing the real screen out from under a still-mounted Ink
 * instance would leave its cursor math pointing at the wrong row on the next
 * redraw, corrupting the display worse than before. Only safe once the Ink
 * instance that owned that content has been fully unmounted first (see the
 * "clear" branch in the loop below), exactly like the existing external-
 * process handoff already does for the same underlying reason.
 */
function clearRealTerminal(): void {
  if (process.stdout.isTTY) {
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
  }
}

/**
 * Runs a not-yet-migrated command in a genuinely fresh child process that
 * directly inherits the real terminal's stdio — this repo's "explicit
 * controlled external-process mode" (only native commands run in-process via
 * InkInteractionService; everything else goes through here, out loud, not
 * silently). Uses execa's *synchronous* spawn deliberately: an async spawn
 * leaves this process's event loop turning while the child "owns" the
 * inherited terminal, and any stray timer/read the parent's stdin stream
 * still had queued at the libuv level can keep consuming keystrokes meant for
 * the child. A synchronous spawn blocks this process's JS thread completely
 * until the child exits — the only way to guarantee zero interference.
 */
function runExternalProcessCommand(commandPath: string[]): void {
  const nodeExecutable = process.argv[0];
  const entryScript = process.argv[1];
  const args = [...process.execArgv, ...(entryScript ? [entryScript] : []), ...commandPath];

  console.log("");
  console.log(`→ smdg ${commandPath.join(" ")}  (external process mode)`);
  console.log("");

  try {
    execaSync(nodeExecutable, args, { stdio: "inherit", reject: false });
  } catch (error) {
    console.log("");
    console.error(error instanceof Error ? error.message : String(error));
  }
}

/** Pause after a command finishes so its output isn't immediately wiped by the next shell redraw. */
function waitForEnter(promptText: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Entry point for `smdg` (no args) / `smdg shell`. Falls back to today's plain
 * group navigator when the terminal can't support the Ink shell (non-TTY, CI).
 *
 * A "native" command (has a bespoke Ink screen, e.g. `git move-code`/`cf org`)
 * runs entirely in-process, in this same render tree, via
 * InkInteractionService — no unmount ever happens for these. Everything else
 * runs through the explicit external-process mode above: cleanly unmount,
 * run the real `smdg <command>` as a genuine child process, then remount a
 * fresh shell. This is deliberately not silent (the breadcrumb says "external
 * process mode") and deliberately not the old in-process handoff model (which
 * let two different terminal-input libraries fight over stdin at once and
 * crash — the reported "Mark this target as favorite?" crash was exactly
 * that).
 */
export async function launchInteractiveShell(program: Command, version: string): Promise<void> {
  const capabilities = detectTerminalCapabilities();

  if (!canLaunchInteractiveShell(capabilities)) {
    await runGroupNavigator(program);
    return;
  }

  installTerminalCrashGuard();
  installTerminalTitleExitRestore();
  pushTerminalTitle(SHELL_TERMINAL_TITLE);

  const registry = buildCommandRegistry(program);
  const cwd = process.cwd();
  // Resolved once, upfront — same reasoning as historySnapshot below: the
  // shell's very first render must already know this data's SHAPE (here,
  // toolChecklist's fixed length of 3 rows) so the live region's fixed-height
  // layout math never has to shift after mount. See SmdgTerminalApp.tsx.
  const [facts, toolChecklist] = await Promise.all([detectContextFacts(cwd), detectToolChecklist()]);

  for (;;) {
    const cache = await readCache();
    const theme = resolveTerminalTheme({ preferred: cache.terminal.theme, noColor: capabilities.noColor });
    // Resolved before this shell instance mounts, same as facts/theme/registry
    // above — seeding "Recent actions" with real data upfront avoids it
    // growing from empty shortly after first paint, which corrupted the live
    // region's redraw (see useCommandHistory.ts).
    const historySnapshot = await loadCommandHistorySnapshot();

    const handoff = await runShellUntilExternalProcessOrExit({
      version,
      headerMode: cache.terminal.headerMode,
      theme,
      capabilities,
      registry,
      projectName: facts.project ?? cwd,
      branchName: facts.branch,
      historySnapshot,
      toolChecklist,
    });

    if (handoff.kind === "quit") {
      popTerminalTitle();
      return;
    }

    if (handoff.kind === "clear") {
      clearRealTerminal();
      continue;
    }

    // The handed-off child process (and the plain readline prompt below)
    // should see the user's real terminal title, not a stale "smdg" left
    // over from the shell it's replacing.
    popTerminalTitle();
    runExternalProcessCommand(handoff.command.path);
    pushTerminalTitle(SHELL_TERMINAL_TITLE);
    console.log("");
    await waitForEnter("Press Enter to return to the console...");
  }
}
