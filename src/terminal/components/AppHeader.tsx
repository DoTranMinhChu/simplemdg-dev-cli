import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { ContextBar, type TContextFacts } from "./ContextBar";
import type { TTerminalHeaderMode } from "../../core/types";

export function AppHeader(props: { version: string; facts: TContextFacts; mode: TTerminalHeaderMode }) {
  const theme = useTerminalTheme();

  if (props.mode === "hidden") {
    return null;
  }

  if (props.mode === "compact") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <ContextBar facts={props.facts} compact />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.border || undefined} paddingX={1} marginBottom={1}>
      <Box justifyContent="space-between">
        <Text bold color={theme.primary || undefined}>
          SimpleMDG Developer Console
        </Text>
        <Text color={theme.muted || undefined}>v{props.version}</Text>
      </Box>
      <ContextBar facts={props.facts} />
    </Box>
  );
}
