import React from "react";
import { Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export type TKeyHint = { key: string; label: string };

export function KeyHintBar(props: { hints: TKeyHint[] }) {
  const theme = useTerminalTheme();

  return (
    <Text color={theme.muted || undefined}>
      {props.hints.map((hint, index) => (
        <Text key={`${hint.key}-${index}`}>
          {index > 0 ? "   " : ""}
          <Text bold>{hint.key}</Text> {hint.label}
        </Text>
      ))}
    </Text>
  );
}
