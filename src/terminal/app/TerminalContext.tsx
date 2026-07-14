import React, { createContext, useContext } from "react";
import type { TTerminalTheme } from "../services/terminal-theme";
import type { TTerminalCapabilities } from "../services/terminal-capabilities";
import type { TInteractiveCommandDefinition } from "../services/command-registry";

export type TTerminalContextValue = {
  theme: TTerminalTheme;
  capabilities: TTerminalCapabilities;
  registry: TInteractiveCommandDefinition[];
  projectName: string;
  branchName?: string;
};

const TerminalContext = createContext<TTerminalContextValue | undefined>(undefined);

export function TerminalContextProvider(props: { value: TTerminalContextValue; children: React.ReactNode }) {
  return <TerminalContext.Provider value={props.value}>{props.children}</TerminalContext.Provider>;
}

export function useTerminalContext(): TTerminalContextValue {
  const context = useContext(TerminalContext);

  if (!context) {
    throw new Error("useTerminalContext must be used within TerminalContextProvider");
  }

  return context;
}
