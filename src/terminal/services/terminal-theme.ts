import type { TTerminalThemeName } from "../../core/types";

/** Semantic color tokens — business/UI code should never hardcode ANSI colors. */
export type TTerminalTheme = {
  name: TTerminalThemeName;
  primary: string;
  secondary: string;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  border: string;
  command: string;
};

const SIMPLEMDG_DARK: TTerminalTheme = {
  name: "simplemdg-dark",
  primary: "#5CC8FF",
  secondary: "#B385F2",
  muted: "#8A8F98",
  success: "#4ADE80",
  warning: "#FACC15",
  danger: "#F87171",
  info: "#5CC8FF",
  border: "#3A3F4B",
  command: "#F5F5F5",
};

const HIGH_CONTRAST: TTerminalTheme = {
  name: "high-contrast",
  primary: "#FFFFFF",
  secondary: "#FFFF00",
  muted: "#CCCCCC",
  success: "#00FF00",
  warning: "#FFFF00",
  danger: "#FF0000",
  info: "#00FFFF",
  border: "#FFFFFF",
  command: "#FFFFFF",
};

// No-Color: every token maps to "" (chalk/Ink render as plain text when given
// an empty/undefined color) — satisfies NO_COLOR and non-TTY/CI output.
const NO_COLOR_THEME: TTerminalTheme = {
  name: "no-color",
  primary: "",
  secondary: "",
  muted: "",
  success: "",
  warning: "",
  danger: "",
  info: "",
  border: "",
  command: "",
};

export const TERMINAL_THEMES: Record<TTerminalThemeName, TTerminalTheme> = {
  "simplemdg-dark": SIMPLEMDG_DARK,
  "high-contrast": HIGH_CONTRAST,
  "no-color": NO_COLOR_THEME,
};

export function resolveTerminalTheme(options: { preferred?: TTerminalThemeName; noColor: boolean }): TTerminalTheme {
  if (options.noColor) {
    return NO_COLOR_THEME;
  }

  return TERMINAL_THEMES[options.preferred ?? "simplemdg-dark"];
}
