import React from "react";
import os from "node:os";
import { Box, Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import type { TContextFacts } from "./ContextBar";
import type { TVersionCheckResult } from "../services/version-check";
import type { TTerminalHeaderMode } from "../../core/types";

function updateLine(version: string, versionCheck: TVersionCheckResult | undefined): string | undefined {
  if (!versionCheck) {
    return undefined;
  }

  return versionCheck.hasUpdate
    ? `Latest version: v${versionCheck.latest} — run "smdg update" to upgrade.`
    : `You're on the latest version (v${version}).`;
}

/**
 * The shell's persistent greeting/status banner — unlike the one-time
 * `<StaticIntro>` (environment checklist + command-group guide, meant to
 * print exactly once), this is part of the LIVE, always-redrawn region: it
 * reappears on every render immediately above whatever's currently on
 * screen, so it stays visible no matter how much Static output (command
 * results, notifications) has scrolled past above it. That's the whole
 * point — a user's real terminal scrollback, once it grows past one screen,
 * would otherwise permanently scroll the greeting out of view.
 */
export function WelcomeBanner(props: {
  version: string;
  headerMode: TTerminalHeaderMode;
  facts: TContextFacts;
  versionCheck: TVersionCheckResult | undefined;
}) {
  const theme = useTerminalTheme();
  const userName = os.userInfo().username;

  if (props.headerMode === "hidden") {
    return null;
  }

  const latest = updateLine(props.version, props.versionCheck);

  if (props.headerMode === "compact") {
    return (
      <Text color={theme.muted || undefined}>
        Hello, {userName} — SimpleMDG CLI v{props.version}
        {props.facts.project ? ` · ${props.facts.project}` : ""}
        {props.facts.branch ? ` (${props.facts.branch})` : ""}
      </Text>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.primary || undefined} paddingX={2} marginBottom={1}>
      <Text bold color={theme.primary || undefined}>
        Hello, {userName}!
      </Text>
      <Text>
        Welcome to <Text bold>SimpleMDG Developer CLI</Text> v{props.version}
      </Text>
      <Text>
        Ready to help with <Text bold>{props.facts.project ?? "this project"}</Text>
        {props.facts.branch ? <Text color={theme.muted || undefined}> on branch {props.facts.branch}</Text> : null}.
      </Text>
      {latest ? <Text color={(props.versionCheck?.hasUpdate ? theme.warning : theme.muted) || undefined}>{latest}</Text> : null}
    </Box>
  );
}
