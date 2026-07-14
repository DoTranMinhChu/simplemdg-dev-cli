import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export type TMultiSelectChoice = { title: string; value: string };

export function MultiSelectList(props: {
  message: string;
  choices: TMultiSelectChoice[];
  hint?: string;
  onSubmit: (values: string[]) => void;
  onCancel: () => void;
}) {
  const theme = useTerminalTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useInput((_input, key) => {
    if (key.escape) {
      props.onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(props.choices.length - 1, index + 1));
      return;
    }

    if (_input === " ") {
      const value = props.choices[selectedIndex]?.value;
      if (!value) return;
      setChecked((current) => {
        const next = new Set(current);
        if (next.has(value)) {
          next.delete(value);
        } else {
          next.add(value);
        }
        return next;
      });
      return;
    }

    if (key.return) {
      props.onSubmit(props.choices.filter((choice) => checked.has(choice.value)).map((choice) => choice.value));
    }
  });

  return (
    <Box flexDirection="column">
      <Text color={theme.primary || undefined} bold>
        {props.message}
      </Text>
      <Text color={theme.muted || undefined}>{props.hint ?? "Space to toggle, Enter to confirm"}</Text>
      {props.choices.map((choice, index) => (
        <Text key={choice.value} color={index === selectedIndex ? theme.primary || undefined : undefined}>
          {checked.has(choice.value) ? "[x] " : "[ ] "}
          {choice.title}
        </Text>
      ))}
    </Box>
  );
}
