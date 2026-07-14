import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export type TConfirmationSeverity = "low" | "high";

export function ConfirmationPanel(props: {
  message: string;
  detail?: string;
  severity?: TConfirmationSeverity;
  /** For "high" severity destructive git/data operations: require typing this exact word (e.g. "DELETE"). */
  typedConfirmationWord?: string;
  initial?: boolean;
  onSubmit: (confirmed: boolean) => void;
  onCancel: () => void;
}) {
  const theme = useTerminalTheme();
  const [typedValue, setTypedValue] = useState("");
  const severity = props.severity ?? "low";
  const requiresTyped = severity === "high" && Boolean(props.typedConfirmationWord);

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel();
      return;
    }

    if (requiresTyped) {
      if (key.return) {
        props.onSubmit(typedValue.trim() === props.typedConfirmationWord);
        return;
      }
      if (key.backspace || key.delete) {
        setTypedValue((current) => current.slice(0, -1));
        return;
      }
      if (!key.ctrl && !key.meta && input) {
        setTypedValue((current) => current + input);
      }
      return;
    }

    if (input.toLowerCase() === "y" || key.return) {
      props.onSubmit(input.toLowerCase() === "n" ? false : true);
      return;
    }

    if (input.toLowerCase() === "n") {
      props.onSubmit(false);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={(severity === "high" ? theme.danger : theme.border) || undefined} paddingX={1}>
      <Text bold color={(severity === "high" ? theme.danger : theme.primary) || undefined}>
        {props.message}
      </Text>
      {props.detail ? <Text color={theme.muted || undefined}>{props.detail}</Text> : null}
      {requiresTyped ? (
        <Text>
          Type <Text bold>{props.typedConfirmationWord}</Text> to confirm: {typedValue}
        </Text>
      ) : (
        <Text color={theme.muted || undefined}>(Y/n)</Text>
      )}
    </Box>
  );
}
