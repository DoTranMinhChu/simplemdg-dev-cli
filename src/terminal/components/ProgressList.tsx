import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import type { TActiveProgress } from "../services/ink-interaction-service";

export function ProgressList(props: { items: TActiveProgress[]; supportsUnicode?: boolean; maxVisible?: number }) {
  const theme = useTerminalTheme();
  const spinnerChar = props.supportsUnicode ?? true ? "◐" : "*";

  if (props.items.length === 0) {
    return null;
  }

  // Reserve one row for the "+N more" summary itself when trimming is needed,
  // so the rendered block never exceeds `maxVisible` rows.
  const overflow = props.maxVisible !== undefined && props.items.length > props.maxVisible;
  const visible = overflow ? props.items.slice(0, Math.max(1, props.maxVisible! - 1)) : props.items;
  const hiddenCount = props.items.length - visible.length;

  return (
    <Box flexDirection="column">
      {visible.map((item) => (
        <Text key={item.id} color={theme.info || undefined}>
          {spinnerChar} {item.label}
          {item.current !== undefined && item.total !== undefined ? (
            <Text color={theme.muted || undefined}>{`  ${item.current}/${item.total}`}</Text>
          ) : null}
        </Text>
      ))}
      {hiddenCount > 0 ? <Text color={theme.muted || undefined}>+{hiddenCount} more in progress</Text> : null}
    </Box>
  );
}
