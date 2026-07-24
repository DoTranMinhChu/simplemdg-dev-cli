import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import type { TCommandHistoryEntry } from "../services/command-history";

/**
 * The idle home screen's only LIVE content now — the environment checklist
 * and command-group legend moved into `<StaticIntro>` (see
 * SmdgTerminalApp.tsx), printed once instead of being recomputed and
 * redrawn on every keystroke. "Recent actions" stays live since it actually
 * changes as commands run.
 */
export function HomeScreen(props: { recent: TCommandHistoryEntry[]; maxVisibleRows?: number }) {
  const theme = useTerminalTheme();

  if (props.recent.length === 0) {
    return null;
  }

  // This block sits inside the live region's fixed-height Box alongside the
  // composer/footer below it (see SmdgTerminalApp.tsx's `maxVisibleRows`).
  // Ink doesn't wrap or scroll overflowing content in a fixed-height Box —
  // it silently clips from the TOP, which previously cut off the "Recent
  // actions" heading itself on shorter terminals since this list always
  // rendered up to 5 items regardless of how much room was actually
  // available. Clamping to the budget (minus 1 row for the heading) keeps
  // the heading itself always visible instead.
  const maxItems = Math.max(0, Math.min(5, (props.maxVisibleRows ?? Number.POSITIVE_INFINITY) - 1));
  const visible = props.recent.slice(0, maxItems);

  if (visible.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>Recent actions</Text>
      {visible.map((entry, index) => (
        <Text key={`${entry.timestamp}-${index}`} color={theme.muted || undefined}>
          {index + 1}. {entry.path.join(" ")}
        </Text>
      ))}
    </Box>
  );
}
