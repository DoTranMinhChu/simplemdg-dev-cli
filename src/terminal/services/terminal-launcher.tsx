import React from "react";
import { render } from "ink";
import type { Command } from "commander";
import { detectTerminalCapabilities, canLaunchInteractiveShell, type TTerminalCapabilities } from "./terminal-capabilities";
import { resolveTerminalTheme, type TTerminalTheme } from "./terminal-theme";
import { buildCommandRegistry, type TInteractiveCommandDefinition } from "./command-registry";
import { detectContextFacts } from "./context-facts";
import { readCache } from "../../core/cache";
import { dispatchLeaf, runGroupNavigator } from "../../core/navigator";
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
 * not-yet-migrated leaf (unmounting first so it can run through traditional dispatch),
 * or with `undefined` when the user exits the shell entirely. */
function runShellUntilLegacyDispatchOrExit(options: TRenderOptions): Promise<TInteractiveCommandDefinition | undefined> {
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
          onDispatchLegacyCommand={(command) => {
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
 * Entry point for `smdg` (no args) / `smdg shell`. Falls back to today's plain
 * group navigator when the terminal can't support the Ink shell (non-TTY, CI).
 */
export async function launchInteractiveShell(program: Command, version: string): Promise<void> {
  const capabilities = detectTerminalCapabilities();

  if (!canLaunchInteractiveShell(capabilities)) {
    await runGroupNavigator(program);
    return;
  }

  const registry = buildCommandRegistry(program);
  const cwd = process.cwd();
  const facts = await detectContextFacts(cwd);

  for (;;) {
    const cache = await readCache();
    const theme = resolveTerminalTheme({ preferred: cache.terminal.theme, noColor: capabilities.noColor });

    const legacyCommand = await runShellUntilLegacyDispatchOrExit({
      version,
      headerMode: cache.terminal.headerMode,
      theme,
      capabilities,
      registry,
      projectName: facts.project ?? cwd,
      branchName: facts.branch,
    });

    if (!legacyCommand) {
      return;
    }

    console.log("");
    console.log(`→ ${legacyCommand.path.join(" ")}`);
    console.log("");
    await dispatchLeaf(legacyCommand.command);
  }
}
