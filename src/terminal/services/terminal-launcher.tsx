import React from "react";
import readline from "node:readline";
import { execaSync } from "execa";
import { render } from "ink";
import type { Command } from "commander";
import { detectTerminalCapabilities, canLaunchInteractiveShell, type TTerminalCapabilities } from "./terminal-capabilities";
import { resolveTerminalTheme, type TTerminalTheme } from "./terminal-theme";
import { buildCommandRegistry, type TInteractiveCommandDefinition } from "./command-registry";
import { detectContextFacts } from "./context-facts";
import { installTerminalCrashGuard } from "./terminal-crash-guard";
import { readCache } from "../../core/cache";
import { runGroupNavigator } from "../../core/navigator";
import { SmdgTerminalApp } from "../app/SmdgTerminalApp";
import { TerminalContextProvider } from "../app/TerminalContext";
import type { TTerminalHeaderMode } from "../../core/types";

type TRenderOptions = {
  version: string;
  headerMode: TTerminalHeaderMode;
  theme: TTerminalTheme;
  capabilities: TTerminalCapabilities;
  registry: TInteractiveCommandDefinition[];
  projectName: string;
  branchName?: string;
};

/** Renders one shell instance; resolves with the chosen command when the user picks a
 * not-yet-migrated leaf (unmounting first so external-process mode can take over), or with
 * `undefined` when the user exits the shell entirely. */
function runShellUntilExternalProcessOrExit(options: TRenderOptions): Promise<TInteractiveCommandDefinition | undefined> {
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
          onExternalProcessCommand={(command) => {
            if (settled) return;
            settled = true;
            instance.unmount();
            resolve(command);
          }}
        />
      </TerminalContextProvider>,
      { exitOnCtrlC: false },
    );

    instance.waitUntilExit().then(() => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    });
  });
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

  const registry = buildCommandRegistry(program);
  const cwd = process.cwd();
  const facts = await detectContextFacts(cwd);

  for (;;) {
    const cache = await readCache();
    const theme = resolveTerminalTheme({ preferred: cache.terminal.theme, noColor: capabilities.noColor });

    const externalCommand = await runShellUntilExternalProcessOrExit({
      version,
      headerMode: cache.terminal.headerMode,
      theme,
      capabilities,
      registry,
      projectName: facts.project ?? cwd,
      branchName: facts.branch,
    });

    if (!externalCommand) {
      return;
    }

    runExternalProcessCommand(externalCommand.path);
    console.log("");
    await waitForEnter("Press Enter to return to the console...");
  }
}
