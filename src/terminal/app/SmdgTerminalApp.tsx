import React, { useEffect, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import { useTerminalContext } from "./TerminalContext";
import { TerminalRouter, STREAMING_SCREENS } from "./TerminalRouter";
import { InteractionHost } from "./InteractionHost";
import { AppHeader, estimateHeaderHeight } from "../components/AppHeader";
import { CommandPalette } from "../components/CommandPalette";
import { CommandInput } from "../components/CommandInput";
import { ProgressList } from "../components/ProgressList";
import { KeyHintBar } from "../components/KeyHintBar";
import { SessionStatusBadge } from "../components/SessionStatusBadge";
import { useGlobalShortcuts } from "../hooks/useKeyboardShortcuts";
import { useSessionRegistry, type TSession } from "../hooks/useSessionRegistry";
import { useCommandHistory } from "../hooks/useCommandHistory";
import { useTerminalSize } from "../hooks/useTerminalSize";
import type { TActiveProgress } from "../services/ink-interaction-service";
import { searchCommands } from "../services/command-search";
import { detectToolChecklist, type TToolCheck } from "../services/context-facts";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TNotification } from "../../core/interaction/interaction-service";
import type { TTerminalHeaderMode } from "../../core/types";

// Below this the fixed-height live region would squeeze the composer/footer
// out entirely on a tiny terminal — better to let content overflow than to
// collapse to nothing.
const MIN_LIVE_REGION_ROWS = 10;
// Rows the live region reserves for its own bottom chrome (idle input block's
// marginTop + one composer line, footer's marginTop + one hint line) before
// handing the rest to whatever content/list is currently on screen.
const FOOTER_CHROME_ROWS = 6;

export function SmdgTerminalApp(props: {
  version: string;
  headerMode: TTerminalHeaderMode;
  onExternalProcessCommand: (command: TInteractiveCommandDefinition) => void;
}) {
  const { theme, capabilities, registry, projectName, branchName } = useTerminalContext();
  const { exit } = useApp();
  const history = useCommandHistory();
  const { columns, rows } = useTerminalSize();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [notifications, setNotifications] = useState<TNotification[]>([]);
  const [activeProgress, setActiveProgress] = useState<TActiveProgress[]>([]);
  const [toolChecklist, setToolChecklist] = useState<TToolCheck[]>([]);
  const [commandTextValue, setCommandTextValue] = useState("");
  const [naturalMatches, setNaturalMatches] = useState<TInteractiveCommandDefinition[]>([]);

  const sessions = useSessionRegistry({
    onNotify: (notification) => setNotifications((current) => [...current, notification]),
    onNeedsFocusNotice: (session: TSession) =>
      setNotifications((current) => [...current, { level: "warn", message: `Switched to "${session.label}" — it needs your input` }]),
  });

  useEffect(() => {
    void detectToolChecklist().then(setToolChecklist);
  }, []);

  // Progress is scoped to whichever session is currently focused — merging in
  // unrelated background sessions' progress would just be confusing clutter.
  useEffect(() => {
    const session = sessions.focusedSession;
    if (!session || session.kind !== "workflow") {
      setActiveProgress([]);
      return;
    }

    setActiveProgress(session.service.getActiveProgress());
    const onProgressChange = (progress: TActiveProgress[]) => setActiveProgress(progress);
    session.service.on("progress-change", onProgressChange);
    return () => {
      session.service.off("progress-change", onProgressChange);
    };
  }, [sessions.focusedSession]);

  function handleCommandChosen(command: TInteractiveCommandDefinition): void {
    setPaletteOpen(false);
    setCommandTextValue("");
    setNaturalMatches([]);

    void history.record({
      id: command.id,
      path: command.path,
      project: projectName,
      timestamp: new Date().toISOString(),
      durationMs: 0,
      success: true,
    });

    if (command.interactiveCapability !== "native") {
      // Not-yet-migrated commands never run in-process inside this Ink tree —
      // that's what caused two terminal-input systems (Ink + a legacy prompt
      // library) to fight over stdin at once, crashing on things like the
      // Cloud Foundry favorite-confirmation prompt. Instead this hands off to
      // the launcher's explicit, controlled external-process mode: cleanly
      // unmount, run the real command as a genuine child process with
      // inherited stdio, then remount fresh. See terminal-launcher.tsx.
      props.onExternalProcessCommand(command);
      return;
    }

    if (STREAMING_SCREENS[command.id]) {
      sessions.launchStreaming(command);
      return;
    }

    sessions.launchWorkflow(command);
  }

  function handleCommandInputSubmit(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) return;

    if (trimmed === "/") {
      setPaletteOpen(true);
      return;
    }

    if (trimmed.startsWith("/")) {
      const query = trimmed.slice(1);
      const [best] = searchCommands(query, registry);
      if (best) {
        handleCommandChosen(best.command);
        return;
      }
      setPaletteOpen(true);
      return;
    }

    // Natural-language discovery: "move code" -> suggest /git move-code.
    const matches = searchCommands(trimmed, registry).slice(0, 5);
    setNaturalMatches(matches.map((match) => match.command));
  }

  useGlobalShortcuts(
    {
      onPalette: () => setPaletteOpen((current) => !current),
      onRecent: () => setPaletteOpen(true),
      onHistorySearch: () => setPaletteOpen(true),
      onClear: () => setNotifications([]),
      onCancelOrExit: () => {
        if (sessions.focusedSession) {
          sessions.cancelFocused();
          return;
        }
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        exit();
      },
      onCycleSession: () => sessions.cycleFocus(),
    },
    { isActive: true },
  );

  const isIdle = !sessions.focusedSession && !paletteOpen;

  // The header and Static notification log render at their natural height and
  // scroll normally into real terminal scrollback (Ink never re-draws
  // committed Static output, so it doesn't count against this box's height).
  // Everything below is the "live" frame Ink does redraw on every change —
  // sizing it to the remaining terminal rows, with a flexGrow spacer ahead of
  // the composer/footer, is what pins the input to the bottom of the visible
  // window and keeps it there as the terminal is resized.
  const headerHeight = estimateHeaderHeight(props.headerMode, columns);
  const liveRegionHeight = Math.max(MIN_LIVE_REGION_ROWS, rows - headerHeight);
  const maxVisibleRows = Math.max(3, liveRegionHeight - FOOTER_CHROME_ROWS);

  return (
    <Box flexDirection="column">
      <AppHeader
        version={props.version}
        mode={props.headerMode}
        facts={{ project: projectName, branch: branchName }}
      />

      <Static items={notifications}>
        {(notification, index) => (
          <Text key={index} color={notificationColor(notification.level, theme)}>
            {notification.level === "step" && notification.current !== undefined
              ? `Step ${notification.current}/${notification.total}  ${notification.message}`
              : notification.message}
          </Text>
        )}
      </Static>

      <Box flexDirection="column" height={liveRegionHeight}>
        {activeProgress.length > 0 ? (
          <ProgressList items={activeProgress} supportsUnicode={capabilities.supportsUnicode} maxVisible={maxVisibleRows} />
        ) : null}

        {paletteOpen ? (
          <CommandPalette
            commands={registry}
            recentIds={history.recent.map((entry) => entry.id)}
            favoriteIds={history.favorites}
            onSubmit={handleCommandChosen}
            onCancel={() => setPaletteOpen(false)}
            maxVisibleRows={maxVisibleRows}
          />
        ) : (
          <TerminalRouter
            focusedSession={sessions.focusedSession}
            commands={registry}
            recent={history.recent}
            toolChecklist={toolChecklist}
            onSessionDone={sessions.finish}
            maxVisibleRows={maxVisibleRows}
          />
        )}

        {sessions.focusedSession?.kind === "workflow" ? (
          <InteractionHost key={sessions.focusedSession.id} service={sessions.focusedSession.service} maxVisibleRows={maxVisibleRows} />
        ) : null}

        <Box flexGrow={1} />

        {isIdle ? (
          <Box flexDirection="column" marginTop={1}>
            {naturalMatches.length > 0 ? (
              <Box flexDirection="column" marginBottom={1}>
                <Text color={theme.muted || undefined}>Did you mean:</Text>
                {naturalMatches.map((match) => (
                  <Text key={match.id} color={theme.primary || undefined}>
                    /{match.path.join(" ")} — {match.description}
                  </Text>
                ))}
              </Box>
            ) : null}
            <CommandInput
              history={history.recent.map((entry) => `/${entry.path.join(" ")}`)}
              placeholder="Type a command, ask for help, or press / to browse actions."
              onSubmit={handleCommandInputSubmit}
              onSlashTrigger={() => setPaletteOpen(true)}
            />
          </Box>
        ) : null}

        <Box marginTop={1} justifyContent="space-between">
          <KeyHintBar hints={footerHints(sessions.focusedSession, paletteOpen)} />
          <SessionStatusBadge count={sessions.sessions.length} cycleHint="Ctrl+N" />
        </Box>
      </Box>
    </Box>
  );
}

function notificationColor(level: TNotification["level"], theme: ReturnType<typeof useTerminalContext>["theme"]): string | undefined {
  switch (level) {
    case "success":
      return theme.success || undefined;
    case "warn":
      return theme.warning || undefined;
    case "error":
      return theme.danger || undefined;
    case "muted":
      return theme.muted || undefined;
    case "step":
      return theme.primary || undefined;
    default:
      return undefined;
  }
}

function footerHints(focusedSession: TSession | undefined, paletteOpen: boolean): { key: string; label: string }[] {
  if (paletteOpen) {
    return [
      { key: "↑↓", label: "Navigate" },
      { key: "Enter", label: "Select" },
      { key: "Esc", label: "Close" },
    ];
  }

  if (focusedSession) {
    return [
      { key: "Ctrl+C", label: "Cancel" },
      { key: "Enter", label: "Expand output" },
      { key: "Ctrl+N", label: "Switch session" },
    ];
  }

  return [
    { key: "/", label: "Commands" },
    { key: "Ctrl+K", label: "Palette" },
    { key: "Ctrl+R", label: "History" },
    { key: "Ctrl+P", label: "Recent" },
    { key: "Ctrl+C", label: "Exit" },
  ];
}
