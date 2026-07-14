import React from "react";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TCommandHistoryEntry } from "../services/command-history";
import type { TToolCheck } from "../services/context-facts";

const QUICK_ACTION_IDS = ["git.move-code", "ai.resume", "cf.apps", "cf.db.studio"];

export function HomeScreen(props: {
  commands: TInteractiveCommandDefinition[];
  recent: TCommandHistoryEntry[];
  toolChecklist: TToolCheck[];
}) {
  const theme = useTerminalTheme();
  const quickActions = QUICK_ACTION_IDS
    .map((id) => props.commands.find((command) => command.id === id))
    .filter((command): command is TInteractiveCommandDefinition => Boolean(command));

  return (
    <Box flexDirection="column">
      <Text color={theme.muted || undefined}>Ready</Text>
      <Text> </Text>
      <Text>Type a command, ask for help, or press / to browse actions.</Text>
      <Text> </Text>

      {props.toolChecklist.length > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Environment</Text>
          {props.toolChecklist.map((tool) => (
            <Text key={tool.label} color={(tool.detected ? theme.success : theme.warning) || undefined}>
              {tool.detected ? "✓" : "⚠"} {tool.label}
              {!tool.detected ? " not found" : ""}
            </Text>
          ))}
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

      {quickActions.length > 0 ? (
        <Box flexDirection="column">
          <Text bold>Quick actions</Text>
          {quickActions.map((command) => (
            <Text key={command.id} color={theme.primary || undefined}>
              {"❯ "}/{command.path.join(" ")}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
