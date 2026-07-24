import React from "react";
import { Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

/** Small, unobtrusive footer indicator for how many sessions are running in the background — the shell's analogue of Claude Code's "N agent(s)" status. Renders nothing when no session is running. */
export function SessionStatusBadge(props: { count: number; cycleHint: string }) {
  const theme = useTerminalTheme();

  if (props.count <= 0) {
    return null;
  }

  return (
    <Text color={theme.muted || undefined}>
      {props.count} running — {props.cycleHint} to switch
    </Text>
  );
}
