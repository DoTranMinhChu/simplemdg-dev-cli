import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export function Stepper(props: { steps: string[]; currentIndex: number; supportsUnicode?: boolean }) {
  const theme = useTerminalTheme();
  const unicode = props.supportsUnicode ?? true;
  const doneSymbol = unicode ? "✓" : "+";
  const activeSymbol = unicode ? "●" : "*";
  const pendingSymbol = unicode ? "○" : "-";

  return (
    <Box flexDirection="column">
      {props.steps.map((step, index) => {
        const isDone = index < props.currentIndex;
        const isActive = index === props.currentIndex;
        const symbol = isDone ? doneSymbol : isActive ? activeSymbol : pendingSymbol;
        const color = isDone ? theme.success : isActive ? theme.primary : theme.muted;

        return (
          <Text key={step} color={color || undefined} bold={isActive}>
            {index + 1} {symbol} {step}
          </Text>
        );
      })}
    </Box>
  );
}
