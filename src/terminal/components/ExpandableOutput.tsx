import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export function ExpandableOutput(props: { label: string; content: string; durationMs?: number; startExpanded?: boolean }) {
  const theme = useTerminalTheme();
  const [expanded, setExpanded] = useState(props.startExpanded ?? false);
  const lineCount = props.content.split("\n").length;

  useInput((_input, key) => {
    if (key.return) {
      setExpanded((current) => !current);
    }
  });

  if (!expanded) {
    return (
      <Box flexDirection="column">
        <Text color={theme.muted || undefined}>
          {props.label} — {lineCount} output line{lineCount === 1 ? "" : "s"}
          {props.durationMs !== undefined ? `  ${(props.durationMs / 1000).toFixed(1)} sec` : ""}
        </Text>
        <Text color={theme.muted || undefined}>Press Enter to expand</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>{props.label}</Text>
      <Text>{props.content}</Text>
      <Text color={theme.muted || undefined}>Press Enter to collapse</Text>
    </Box>
  );
}
