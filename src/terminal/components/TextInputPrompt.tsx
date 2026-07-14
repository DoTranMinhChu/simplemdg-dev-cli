import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export function TextInputPrompt(props: {
  message: string;
  initial?: string;
  validate?: (value: string) => true | string;
  mask?: boolean;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const theme = useTerminalTheme();
  const [value, setValue] = useState(props.initial ?? "");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel();
      return;
    }

    if (key.return) {
      const validation = props.validate?.(value) ?? (value.trim() ? true : "Value is required");
      if (validation !== true) {
        setErrorMessage(validation);
        return;
      }
      props.onSubmit(value.trim());
      return;
    }

    if (key.backspace || key.delete) {
      setValue((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setValue((current) => current + input);
      setErrorMessage(undefined);
    }
  });

  return (
    <Box flexDirection="column">
      <Text color={theme.primary || undefined} bold>
        {props.message}
      </Text>
      <Text>
        {"> "}
        {props.mask ? "*".repeat(value.length) : value}
        <Text inverse> </Text>
      </Text>
      {errorMessage ? <Text color={theme.danger || undefined}>{errorMessage}</Text> : null}
    </Box>
  );
}
