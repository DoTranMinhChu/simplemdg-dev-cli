import React, { useEffect, useMemo, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import { useTerminalContext } from "./TerminalContext";
import { TerminalRouter, STREAMING_SCREENS } from "./TerminalRouter";
import { InteractionHost } from "./InteractionHost";
import { StaticIntro, buildCommandGroups } from "../components/StaticIntro";
import { WelcomeBanner } from "../components/WelcomeBanner";
import { CommandPalette } from "../components/CommandPalette";
import { SessionSwitcher } from "../components/SessionSwitcher";
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
import { checkLatestVersion, type TVersionCheckResult } from "../services/version-check";
import type { TToolCheck } from "../services/context-facts";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TCommandHistorySnapshot } from "../services/command-history";
import type { TNotification } from "../../core/interaction/interaction-service";
import type { TTerminalHeaderMode } from "../../core/types";

// A soft UX budget, not a hard clipping boundary (the live region has no
// fixed height for Ink to clip against anymore — see the render method below)
// — keeps list-style screens (palette, progress, session switcher, recent
// actions) from trying to cram too many rows onto a small terminal. Covers
// the welcome banner + idle composer + footer's own rows.
const RESERVED_CHROME_ROWS = 10;

/** One entry in the shell's single, unified `<Static>` list — see the render method below for why this must stay a single Static instance (Ink only tracks one "static root" per app; splitting the intro and the notification log into two separate `<Static>` components would silently break one of them). */
type TStaticEntry =
  | { kind: "intro"; key: "intro" }
  | { kind: "notification"; key: string; notification: TNotification };

export function SmdgTerminalApp(props: {
  version: string;
  headerMode: TTerminalHeaderMode;
  historySnapshot: TCommandHistorySnapshot;
  toolChecklist: TToolCheck[];
  onExternalProcessCommand: (command: TInteractiveCommandDefinition) => void;
  onClearRequested: () => void;
}) {
  const { theme, capabilities, registry, projectName, branchName } = useTerminalContext();
  const { exit } = useApp();
  const history = useCommandHistory(props.historySnapshot);
  const { columns, rows } = useTerminalSize();

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [notifications, setNotifications] = useState<TNotification[]>([]);
  const [activeProgress, setActiveProgress] = useState<TActiveProgress[]>([]);
  const [commandTextValue, setCommandTextValue] = useState("");
  const [naturalMatches, setNaturalMatches] = useState<TInteractiveCommandDefinition[]>([]);
  const [versionCheck, setVersionCheck] = useState<TVersionCheckResult | undefined>(undefined);

  // Fire-and-forget, resolved well after mount — safe because the banner is
  // plain LIVE content now (see WelcomeBanner.tsx), not something a fixed-
  // height container could clip or shift around when this arrives late.
  useEffect(() => {
    void checkLatestVersion(props.version).then(setVersionCheck);
  }, [props.version]);

  const sessions = useSessionRegistry({
    onNotify: (notification) => setNotifications((current) => [...current, notification]),
    onNeedsFocusNotice: (session: TSession) =>
      setNotifications((current) => [...current, { level: "warn", message: `Switched to "${session.label}" — it needs your input` }]),
  });

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

    if (trimmed.toLowerCase() === "clear" || trimmed.toLowerCase() === "/clear") {
      props.onClearRequested();
      return;
    }

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
      // A plain in-memory `setNotifications([])` only hid the LIVE notification
      // log — it never touched the already-committed `<Static>` content (the
      // environment checklist, past command output) permanently burned into
      // the real terminal's scrollback, so the screen stayed just as
      // cluttered. A real clear needs to wipe the actual terminal, which is
      // only safe once Ink has fully unmounted — see terminal-launcher.tsx.
      onClear: () => props.onClearRequested(),
      onCancelOrExit: () => {
        if (switcherOpen) {
          setSwitcherOpen(false);
          return;
        }
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
      // Ctrl+N used to blindly cycle focus one session at a time — with
      // several sessions running (e.g. two Studio tools) that meant guessing
      // your way through them with no visibility into what each one even
      // was. It now opens an explicit, searchable list instead (see
      // SessionSwitcher.tsx) so you can see and pick the one you actually want.
      onCycleSession: () => {
        if (sessions.sessions.length === 0) {
          return;
        }
        setSwitcherOpen((current) => !current);
      },
    },
    { isActive: true },
  );

  const isIdle = !sessions.focusedSession && !paletteOpen && !switcherOpen;
  const commandGroups = useMemo(() => buildCommandGroups(registry), [registry]);

  // The environment checklist + command-group legend and the notification
  // log both live in ONE unified `<Static>` list below — Ink only tracks a
  // single "static root" per app, so they can't be two separate `<Static>`
  // components. `toolChecklist` arrives as a prop already resolved BEFORE
  // this component's first render (see terminal-launcher.tsx), so the intro
  // entry is present from render one. The greeting/version banner is
  // deliberately NOT part of this Static list — see WelcomeBanner.tsx for why.
  const staticEntries: TStaticEntry[] = [
    { kind: "intro", key: "intro" },
    ...notifications.map((notification, index): TStaticEntry => ({ kind: "notification", key: `notification-${index}`, notification })),
  ];

  const maxVisibleRows = Math.max(3, rows - RESERVED_CHROME_ROWS);
  // "Did you mean" and HomeScreen's "Recent actions" can both be on screen at
  // once (both only show while idle) and SHARE this one budget — each
  // independently capping itself to the full `maxVisibleRows` would let
  // their combined height run long on a small terminal. "Did you mean" is the
  // direct result of what the user just typed, so it claims its (small, capped)
  // share first; whatever's left goes to "Recent actions" via
  // `homeScreenMaxRows` below. Sessions always clear naturalMatches on launch
  // (see handleCommandChosen), so this never shrinks the budget for any
  // focused-session screen — only the idle HomeScreen path is affected.
  const visibleNaturalMatches = naturalMatches.slice(0, Math.max(0, Math.min(3, maxVisibleRows - 1)));
  const naturalMatchesRows = visibleNaturalMatches.length > 0 ? 1 + visibleNaturalMatches.length : 0;
  const homeScreenMaxRows = Math.max(0, maxVisibleRows - naturalMatchesRows);

  return (
    <Box flexDirection="column">
      <Static items={staticEntries}>
        {(entry) =>
          entry.kind === "intro" ? (
            <StaticIntro key={entry.key} toolChecklist={props.toolChecklist} commandGroups={commandGroups} columns={columns} />
          ) : (
            <Text key={entry.key} color={notificationColor(entry.notification.level, theme)}>
              {entry.notification.level === "step" && entry.notification.current !== undefined
                ? `Step ${entry.notification.current}/${entry.notification.total}  ${entry.notification.message}`
                : entry.notification.message}
            </Text>
          )
        }
      </Static>

      <Box flexDirection="column">
        {/* LIVE, not Static — reprinted on every render so it stays visible
            immediately above whatever's current, no matter how much Static
            output (command results, notifications) has scrolled past above
            it in the real terminal's scrollback. */}
        <WelcomeBanner version={props.version} headerMode={props.headerMode} facts={{ project: projectName, branch: branchName }} versionCheck={versionCheck} />

        {!switcherOpen && activeProgress.length > 0 ? (
          <ProgressList items={activeProgress} supportsUnicode={capabilities.supportsUnicode} maxVisible={maxVisibleRows} />
        ) : null}

        {switcherOpen ? (
          <SessionSwitcher
            sessions={sessions.sessions}
            focusedSessionId={sessions.focusedSession?.id}
            onSelect={(sessionId) => {
              setSwitcherOpen(false);
              if (sessionId === undefined) {
                sessions.focusHome();
              } else {
                sessions.focusSession(sessionId);
              }
            }}
            onCancel={() => setSwitcherOpen(false)}
            maxVisibleRows={maxVisibleRows}
          />
        ) : paletteOpen ? (
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
            recent={history.recent}
            onSessionDone={sessions.finish}
            maxVisibleRows={homeScreenMaxRows}
          />
        )}

        {!switcherOpen && sessions.focusedSession?.kind === "workflow" ? (
          <InteractionHost key={sessions.focusedSession.id} service={sessions.focusedSession.service} maxVisibleRows={maxVisibleRows} />
        ) : null}

        {isIdle ? (
          <Box flexDirection="column" marginTop={1}>
            {visibleNaturalMatches.length > 0 ? (
              <Box flexDirection="column" marginBottom={1}>
                <Text color={theme.muted || undefined}>Did you mean:</Text>
                {visibleNaturalMatches.map((match) => (
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
          <KeyHintBar hints={footerHints(sessions.focusedSession, paletteOpen, switcherOpen)} />
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

function footerHints(focusedSession: TSession | undefined, paletteOpen: boolean, switcherOpen: boolean): { key: string; label: string }[] {
  if (switcherOpen || paletteOpen) {
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
    { key: "Ctrl+L", label: "Clear" },
    { key: "Ctrl+C", label: "Exit" },
  ];
}
