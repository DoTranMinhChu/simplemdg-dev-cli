import { useTerminalContext } from "../app/TerminalContext";
import type { TTerminalTheme } from "../services/terminal-theme";

export function useTerminalTheme(): TTerminalTheme {
  return useTerminalContext().theme;
}
