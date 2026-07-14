import React from "react";
import { Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export type TStatus = "queued" | "running" | "success" | "warning" | "failed" | "cancelled" | "skipped";

const SYMBOLS: Record<TStatus, string> = {
  queued: "○",
  running: "◐",
  success: "✓",
  warning: "⚠",
  failed: "✗",
  cancelled: "■",
  skipped: "–",
};

const ASCII_SYMBOLS: Record<TStatus, string> = {
  queued: "o",
  running: "*",
  success: "+",
  warning: "!",
  failed: "x",
  cancelled: "#",
  skipped: "-",
};

export function statusSymbol(status: TStatus, supportsUnicode: boolean): string {
  return supportsUnicode ? SYMBOLS[status] : ASCII_SYMBOLS[status];
}

export function StatusBadge(props: { status: TStatus; label: string; meta?: string; supportsUnicode?: boolean }) {
  const theme = useTerminalTheme();
  const symbol = statusSymbol(props.status, props.supportsUnicode ?? true);

  const color = (): string => {
    switch (props.status) {
      case "success":
        return theme.success;
      case "warning":
        return theme.warning;
      case "failed":
        return theme.danger;
      case "running":
        return theme.info;
      case "cancelled":
        return theme.muted;
      case "skipped":
        return theme.muted;
      default:
        return theme.muted;
    }
  };

  return (
    <Text color={color() || undefined}>
      {symbol} {props.label}
      {props.meta ? <Text color={theme.muted || undefined}>{"  "}{props.meta}</Text> : null}
    </Text>
  );
}
