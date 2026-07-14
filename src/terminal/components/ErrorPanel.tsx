import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export type TErrorAction = { label: string };

export function ErrorPanel(props: {
  title: string;
  message: string;
  suggestions?: string[];
  technicalDetails?: string;
}) {
  const theme = useTerminalTheme();
  const [expanded, setExpanded] = useState(false);

  useInput((_input, key) => {
    if (key.return && props.technicalDetails) {
      setExpanded((current) => !current);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.danger || undefined} paddingX={1}>
      <Text bold color={theme.danger || undefined}>
        {props.title}
      </Text>
      <Text>{props.message}</Text>
      {props.suggestions && props.suggestions.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted || undefined}>Try:</Text>
          {props.suggestions.map((suggestion) => (
            <Text key={suggestion}>{"  • "}{suggestion}</Text>
          ))}
        </Box>
      ) : null}
      {props.technicalDetails ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color={theme.muted || undefined}>{expanded ? "Technical details (Enter to collapse):" : "Press Enter for technical details"}</Text>
          {expanded ? <Text color={theme.muted || undefined}>{props.technicalDetails}</Text> : null}
        </Box>
      ) : null}
    </Box>
  );
}
