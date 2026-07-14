import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { bestScoreMatch } from "../../core/fuzzy-match";

export type TSearchableListChoice = { title: string; value: string; description?: string };

const CUSTOM_VALUE_PREFIX = "__SMDG_INK_CUSTOM_VALUE__:";

export function SearchableList(props: {
  message: string;
  choices: TSearchableListChoice[];
  allowCustomValue?: boolean;
  customValueTitle?: (value: string) => string;
  validateCustomValue?: (value: string) => true | string;
  limit?: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const theme = useTerminalTheme();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const filtered = useMemo(() => {
    const trimmed = query.trim();

    if (!trimmed) {
      return props.choices;
    }

    return props.choices
      .map((choice) => ({ choice, score: bestScoreMatch(trimmed, [choice.title, choice.value, choice.description ?? ""]) }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.choice);
  }, [query, props.choices]);

  const trimmedQuery = query.trim();
  const hasExactMatch = filtered.some(
    (choice) => choice.title.toLowerCase() === trimmedQuery.toLowerCase() || choice.value.toLowerCase() === trimmedQuery.toLowerCase(),
  );
  const showCustomRow = Boolean(props.allowCustomValue) && trimmedQuery.length > 0 && !hasExactMatch;
  const visible = filtered.slice(0, props.limit ?? 12);
  const rows: TSearchableListChoice[] = showCustomRow
    ? [...visible, { title: props.customValueTitle?.(trimmedQuery) ?? `Use typed value: ${trimmedQuery}`, value: `${CUSTOM_VALUE_PREFIX}${trimmedQuery}` }]
    : visible;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useInput((input, key) => {
    if (key.escape) {
      props.onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((index) => Math.max(0, index - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((index) => Math.min(Math.max(rows.length - 1, 0), index + 1));
      return;
    }

    if (key.return) {
      const chosen = rows[selectedIndex];
      if (!chosen) return;

      if (chosen.value.startsWith(CUSTOM_VALUE_PREFIX)) {
        const raw = chosen.value.slice(CUSTOM_VALUE_PREFIX.length);
        const validation = props.validateCustomValue?.(raw) ?? (raw ? true : "Value is required");
        if (validation !== true) {
          setErrorMessage(validation);
          return;
        }
        props.onSubmit(raw);
        return;
      }

      props.onSubmit(chosen.value);
      return;
    }

    if (key.tab) {
      const chosen = rows[selectedIndex];
      if (chosen && !chosen.value.startsWith(CUSTOM_VALUE_PREFIX)) {
        setQuery(chosen.title);
      }
      return;
    }

    if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && input) {
      setQuery((current) => current + input);
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
        {query}
        {!query && <Text color={theme.muted || undefined}> type to filter</Text>}
      </Text>
      {errorMessage ? <Text color={theme.danger || undefined}>{errorMessage}</Text> : null}
      {rows.length === 0 ? (
        <Text color={theme.muted || undefined}>No matches</Text>
      ) : (
        rows.map((choice, index) => (
          <Text key={`${choice.value}-${index}`} color={theme.primary || undefined} inverse={index === selectedIndex}>
            {choice.title}
            {choice.description ? <Text color={theme.muted || undefined}>{"  — "}{choice.description}</Text> : null}
          </Text>
        ))
      )}
    </Box>
  );
}
