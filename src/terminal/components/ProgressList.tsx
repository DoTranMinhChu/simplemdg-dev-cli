import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import type { TActiveProgress } from "../services/ink-interaction-service";

export function ProgressList(props: { items: TActiveProgress[]; supportsUnicode?: boolean }) {
  const theme = useTerminalTheme();
  const spinnerChar = props.supportsUnicode ?? true ? "◐" : "*";

  if (props.items.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {props.items.map((item) => (
        <Text key={item.id} color={theme.info || undefined}>
          {spinnerChar} {item.label}
          {item.current !== undefined && item.total !== undefined ? (
            <Text color={theme.muted || undefined}>{`  ${item.current}/${item.total}`}</Text>
          ) : null}
        </Text>
      ))}
    </Box>
  );
}
