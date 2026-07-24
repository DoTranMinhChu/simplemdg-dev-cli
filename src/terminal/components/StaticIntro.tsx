import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { CATEGORY_LABELS, CATEGORY_TAGLINES } from "../services/command-registry-metadata";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TToolCheck } from "../services/context-facts";

export type TCommandGroup = { slug: string; label: string; tagline: string };

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
export function buildCommandGroups(commands: TInteractiveCommandDefinition[]): TCommandGroup[] {
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

/**
 * The shell's one-time environment checklist + command-group legend.
 * Rendered exactly ONCE, inside the shell's `<Static>` list (see
 * SmdgTerminalApp.tsx): unlike everything else in the live region, this
 * never gets re-drawn on every keystroke, which is what keeps it from
 * visually corrupting (stale characters left over from a shorter subsequent
 * frame) and keeps it permanently at the top of scrollback instead of being
 * recomputed and reprinted on every interaction. The greeting/version/update
 * banner used to live here too, but that needed to stay visible even after
 * this has scrolled out of view — see `<WelcomeBanner>`, which is LIVE
 * instead for exactly that reason.
 */
export function StaticIntro(props: { toolChecklist: TToolCheck[]; commandGroups: TCommandGroup[]; columns: number }) {
  const theme = useTerminalTheme();
  const { commandGroups } = props;
  const groupColumnWidth = commandGroups.length > 0 ? Math.max(...commandGroups.map((group) => group.slug.length)) + 5 : 0;
  // Panel overhead this row sits inside of: 1 left-border char + 1 paddingLeft.
  const taglineMaxWidth = Math.max(0, props.columns - groupColumnWidth - 2);
  const hasTips = props.toolChecklist.length > 0 || commandGroups.length > 0;

  if (!hasTips) {
    return null;
  }

  return (
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
  );
}
