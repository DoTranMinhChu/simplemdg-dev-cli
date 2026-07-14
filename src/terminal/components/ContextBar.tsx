import React from "react";
import { Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";

export type TContextFacts = {
  project?: string;
  branch?: string;
  cfTarget?: string;
  capMode?: string;
};

/** Only renders facts that were actually detected — never fabricates environment info. */
export function ContextBar(props: { facts: TContextFacts; compact?: boolean }) {
  const theme = useTerminalTheme();
  const parts: string[] = [];

  if (props.facts.project) parts.push(props.facts.project);
  if (props.facts.branch) parts.push(props.compact ? props.facts.branch : `Branch: ${props.facts.branch}`);
  if (props.facts.cfTarget) parts.push(props.compact ? props.facts.cfTarget : `CF ${props.facts.cfTarget}`);
  if (props.facts.capMode) parts.push(props.compact ? props.facts.capMode : `CAP ${props.facts.capMode}`);

  if (parts.length === 0) {
    return null;
  }

  return <Text color={theme.muted || undefined}>{parts.join(props.compact ? "  " : "  ·  ")}</Text>;
}
