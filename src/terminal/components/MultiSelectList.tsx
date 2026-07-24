import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export type TMultiSelectChoice = { title: string; value: string; selected?: boolean };

export function MultiSelectList(props: {
  message: string;
  choices: TMultiSelectChoice[];
  hint?: string;
  /** Rows available before the composer/footer chrome — see SmdgTerminalApp.tsx. Undefined renders every choice (historical behavior). */
  maxVisibleRows?: number;
  onSubmit: (values: string[]) => void;
  onCancel: () => void;
}) {
  const theme = useTerminalTheme();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(props.choices.filter((choice) => choice.selected).map((choice) => choice.value)),
  );

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

  // Message(1) + hint(1) are always-on chrome above the choice rows; a "N
  // above"/"N below" indicator costs one more row each only when actually
  // shown. Keep the window centered on `selectedIndex` so paging up/down
  // never leaves the cursor's row scrolled out of view.
  const chromeRows = 2;
  const visibleCount = props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - chromeRows) : props.choices.length;
  const windowStart =
    props.choices.length > visibleCount
      ? Math.min(Math.max(0, selectedIndex - Math.floor(visibleCount / 2)), props.choices.length - visibleCount)
      : 0;
  const windowEnd = Math.min(props.choices.length, windowStart + visibleCount);
  const hiddenAbove = windowStart;
  const hiddenBelow = props.choices.length - windowEnd;

  return (
    <Box flexDirection="column">
      <Text color={theme.primary || undefined} bold>
        {props.message}
      </Text>
      <Text color={theme.muted || undefined}>{props.hint ?? "Space to toggle, Enter to confirm"}</Text>
      {hiddenAbove > 0 ? <Text color={theme.muted || undefined}>↑ {hiddenAbove} more above</Text> : null}
      {props.choices.slice(windowStart, windowEnd).map((choice, localIndex) => {
        const index = windowStart + localIndex;
        return (
          <Text key={choice.value} color={index === selectedIndex ? theme.primary || undefined : undefined}>
            {checked.has(choice.value) ? "[x] " : "[ ] "}
            {choice.title}
          </Text>
        );
      })}
      {hiddenBelow > 0 ? <Text color={theme.muted || undefined}>↓ {hiddenBelow} more below</Text> : null}
    </Box>
  );
}
