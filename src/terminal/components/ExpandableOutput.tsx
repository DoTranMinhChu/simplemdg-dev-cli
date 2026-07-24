import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export function ExpandableOutput(props: {
  label: string;
  content: string;
  durationMs?: number;
  startExpanded?: boolean;
  /** Caps rendered lines once expanded (with ↑/↓-scrollable overflow) — expanded output can otherwise be arbitrarily long. Defaults to 20. */
  maxHeight?: number;
}) {
  const theme = useTerminalTheme();
  const [expanded, setExpanded] = useState(props.startExpanded ?? false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const lines = props.content.split("\n");
  const lineCount = lines.length;
  const maxHeight = props.maxHeight ?? 20;
  const maxOffset = Math.max(0, lineCount - maxHeight);
  const needsPaging = expanded && lineCount > maxHeight;
  const clampedOffset = Math.min(scrollOffset, maxOffset);

  useInput((_input, key) => {
    if (key.return) {
      setExpanded((current) => !current);
      setScrollOffset(0);
      return;
    }

    if (!needsPaging) {
      return;
    }

    if (key.upArrow) {
      setScrollOffset((current) => Math.max(0, current - 1));
      return;
    }

    if (key.downArrow) {
      setScrollOffset((current) => Math.min(maxOffset, current + 1));
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

  const visibleLines = needsPaging ? lines.slice(clampedOffset, clampedOffset + maxHeight) : lines;

  return (
    <Box flexDirection="column">
      <Text bold>{props.label}</Text>
      <Text>{visibleLines.join("\n")}</Text>
      {needsPaging ? (
        <Text color={theme.muted || undefined}>
          Lines {clampedOffset + 1}-{Math.min(clampedOffset + maxHeight, lineCount)} of {lineCount} — ↑/↓ to scroll
        </Text>
      ) : null}
      <Text color={theme.muted || undefined}>Press Enter to collapse</Text>
    </Box>
  );
}
