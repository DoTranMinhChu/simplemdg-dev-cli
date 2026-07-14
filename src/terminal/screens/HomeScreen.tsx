import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { useTerminalSize } from "../hooks/useTerminalSize";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TCommandHistoryEntry } from "../services/command-history";
import type { TToolCheck } from "../services/context-facts";
import { CATEGORY_LABELS, CATEGORY_TAGLINES } from "../services/command-registry-metadata";

type TCommandGroup = { slug: string; label: string; tagline: string };

/** Keeps each "/slug  tagline" row on one line — an Ink Text that wraps mid-row
 * loses the column alignment (the wrapped remainder starts flush against the
 * panel's left border with no indent), which reads as a broken layout on
 * narrow terminals. Truncating is preferable to that. */
function truncateToWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  if (text.length <= maxWidth) {
    return text;
  }
  if (maxWidth === 1) {
    return "…";
  }
  return `${text.slice(0, maxWidth - 1)}…`;
}

/**
 * Derives the top-level group legend ("/cf — Targets, apps, logs & DB
 * Studio", ...) straight from whatever groups are actually registered, in
 * their registration order — never a hand-maintained list, so it can't drift
 * from the real command tree.
 */
function buildCommandGroups(commands: TInteractiveCommandDefinition[]): TCommandGroup[] {
  const slugs: string[] = [];

  for (const command of commands) {
    const slug = command.path[0];
    if (slug && !slugs.includes(slug)) {
      slugs.push(slug);
    }
  }

  return slugs.map((slug) => ({
    slug,
    label: CATEGORY_LABELS[slug] ?? slug,
    tagline: CATEGORY_TAGLINES[slug] ?? `${commands.filter((command) => command.path[0] === slug).length} commands`,
  }));
}

export function HomeScreen(props: {
  commands: TInteractiveCommandDefinition[];
  recent: TCommandHistoryEntry[];
  toolChecklist: TToolCheck[];
}) {
  const theme = useTerminalTheme();
  const { columns } = useTerminalSize();
  const commandGroups = buildCommandGroups(props.commands);
  const groupColumnWidth = commandGroups.length > 0 ? Math.max(...commandGroups.map((group) => group.slug.length)) + 5 : 0;
  // Panel overhead this row sits inside of: 1 left-border char + 1 paddingLeft.
  const taglineMaxWidth = Math.max(0, columns - groupColumnWidth - 2);

  const hasTips = props.toolChecklist.length > 0 || commandGroups.length > 0;

  return (
    <Box flexDirection="column">
      {hasTips ? (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.secondary || undefined}
          borderTop={false}
          borderRight={false}
          borderBottom={false}
          paddingLeft={1}
          marginBottom={1}
        >
          {props.toolChecklist.length > 0 ? (
            <Box flexDirection="column" marginBottom={commandGroups.length > 0 ? 1 : 0}>
              <Text bold>Environment</Text>
              {props.toolChecklist.map((tool) => (
                <Text key={tool.label} color={(tool.detected ? theme.success : theme.warning) || undefined}>
                  {tool.detected ? "✓" : "⚠"} {tool.label}
                  {!tool.detected ? " not found" : ""}
                </Text>
              ))}
            </Box>
          ) : null}

          {commandGroups.length > 0 ? (
            <Box flexDirection="column">
              <Text bold>Command groups</Text>
              {commandGroups.map((group) => (
                <Text key={group.slug}>
                  <Text color={theme.primary || undefined}>{`❯ /${group.slug}`.padEnd(groupColumnWidth)}</Text>
                  <Text color={theme.muted || undefined}>{truncateToWidth(group.tagline, taglineMaxWidth)}</Text>
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : null}

      {props.recent.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Recent actions</Text>
          {props.recent.slice(0, 5).map((entry, index) => (
            <Text key={`${entry.timestamp}-${index}`} color={theme.muted || undefined}>
              {index + 1}. {entry.path.join(" ")}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
