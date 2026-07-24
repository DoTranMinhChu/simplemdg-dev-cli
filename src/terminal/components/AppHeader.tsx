import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { useTerminalSize } from "../hooks/useTerminalSize";
import { ContextBar, type TContextFacts } from "./ContextBar";
import type { TTerminalHeaderMode } from "../../core/types";

const TITLE = "SimpleMDG Developer Console";
// Below this, "<title>" and "v<version>" can no longer share one row without
// Yoga overlapping them (Ink Box row layout has no flex-wrap) — stack instead.
const NARROW_TITLE_ROW_THRESHOLD = TITLE.length + 12;

/**
 * Single source of truth for how many terminal rows `<AppHeader>` will
 * actually render, given the same mode/width inputs the component itself
 * uses. Callers (the root shell layout) need this number up front to size
 * the fixed-height live region that keeps the composer pinned to the bottom
 * of the viewport — it must stay in lockstep with the JSX below by hand.
 */
export function estimateHeaderHeight(mode: TTerminalHeaderMode, columns: number): number {
  if (mode === "hidden") {
    return 0;
  }

  if (mode === "compact") {
    // ContextBar (1 line) + marginBottom(1).
    return 2;
  }

  const isNarrow = columns < NARROW_TITLE_ROW_THRESHOLD;
  const titleRowLines = isNarrow ? 2 : 1;
  // borderTop(1) + title row(s) + blank Text(1) + "Ready to help" line(1) + borderBottom(1) + marginBottom(1).
  return 1 + titleRowLines + 1 + 1 + 1 + 1;
}

export function AppHeader(props: { version: string; facts: TContextFacts; mode: TTerminalHeaderMode }) {
  const theme = useTerminalTheme();
  const { columns } = useTerminalSize();

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

  const isNarrow = columns < NARROW_TITLE_ROW_THRESHOLD;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary || undefined} paddingX={2} marginBottom={1}>
      <Box flexDirection={isNarrow ? "column" : "row"} justifyContent={isNarrow ? "flex-start" : "space-between"}>
        <Text bold color={theme.primary || undefined}>
          {TITLE}
        </Text>
        <Text color={theme.muted || undefined}>v{props.version}</Text>
      </Box>
      <Text> </Text>
      <Text>
        Ready to help with <Text bold>{props.facts.project ?? "this project"}</Text>
        {props.facts.branch ? <Text color={theme.muted || undefined}> on branch {props.facts.branch}</Text> : null}.
      </Text>
    </Box>
  );
}
