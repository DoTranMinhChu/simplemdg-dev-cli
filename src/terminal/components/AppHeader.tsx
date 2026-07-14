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
