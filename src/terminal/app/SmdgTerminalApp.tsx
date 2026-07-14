import React, { useEffect, useState } from "react";
import { Box, Static, Text, useApp } from "ink";
import { useTerminalContext } from "./TerminalContext";
import { TerminalRouter, type TTerminalRoute } from "./TerminalRouter";
import { InteractionHost } from "./InteractionHost";
import { AppHeader } from "../components/AppHeader";
import { CommandPalette } from "../components/CommandPalette";
import { CommandInput } from "../components/CommandInput";
import { ProgressList } from "../components/ProgressList";
import { KeyHintBar } from "../components/KeyHintBar";
import { useGlobalShortcuts } from "../hooks/useKeyboardShortcuts";
import { useCancellation } from "../hooks/useCancellation";
import { useCommandHistory } from "../hooks/useCommandHistory";
import { InkInteractionService, type TActiveProgress } from "../services/ink-interaction-service";
import { searchCommands } from "../services/command-search";
import { detectToolChecklist, type TToolCheck } from "../services/context-facts";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TNotification } from "../../core/interaction/interaction-service";
import type { TTerminalHeaderMode } from "../../core/types";

export function SmdgTerminalApp(props: {
  version: string;
  headerMode: TTerminalHeaderMode;
  onExternalProcessCommand: (command: TInteractiveCommandDefinition) => void;
}) {
  const { theme, capabilities, registry, projectName, branchName } = useTerminalContext();
  const { exit } = useApp();
  const cancellation = useCancellation();
  const history = useCommandHistory();

  const [route, setRoute] = useState<TTerminalRoute>({ screen: "home" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeService, setActiveService] = useState<InkInteractionService | undefined>(undefined);
  const [notifications, setNotifications] = useState<TNotification[]>([]);
  const [activeProgress, setActiveProgress] = useState<TActiveProgress[]>([]);
  const [toolChecklist, setToolChecklist] = useState<TToolCheck[]>([]);
  const [commandTextValue, setCommandTextValue] = useState("");
  const [naturalMatches, setNaturalMatches] = useState<TInteractiveCommandDefinition[]>([]);

  useEffect(() => {
    void detectToolChecklist().then(setToolChecklist);
  }, []);

  function launchWorkflow(command: TInteractiveCommandDefinition): void {
    const controller = cancellation.begin();
    const service = new InkInteractionService(controller.signal);
    service.on("notify", (notification: TNotification) => {
      setNotifications((current) => [...current, notification]);
    });
    service.on("progress-change", (progress: TActiveProgress[]) => {
      setActiveProgress(progress);
    });
    setActiveService(service);
    setRoute({ screen: "workflow", commandId: command.id });
  }

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

    launchWorkflow(command);
  }

  function handleWorkflowDone(): void {
    cancellation.end();
    setActiveService(undefined);
    setActiveProgress([]);
    setRoute({ screen: "home" });
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
        if (route.screen === "workflow") {
          cancellation.cancel();
          return;
        }
        if (paletteOpen) {
          setPaletteOpen(false);
          return;
        }
        exit();
      },
    },
    { isActive: true },
  );

  const isIdle = route.screen === "home" && !paletteOpen;

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

      {activeProgress.length > 0 ? <ProgressList items={activeProgress} supportsUnicode={capabilities.supportsUnicode} /> : null}

      {paletteOpen ? (
        <CommandPalette
          commands={registry}
          recentIds={history.recent.map((entry) => entry.id)}
          favoriteIds={history.favorites}
          onSubmit={handleCommandChosen}
          onCancel={() => setPaletteOpen(false)}
        />
      ) : (
        <TerminalRouter
          route={route}
          commands={registry}
          recent={history.recent}
          toolChecklist={toolChecklist}
          activeService={activeService}
          onWorkflowDone={handleWorkflowDone}
        />
      )}

      {route.screen === "workflow" && activeService ? <InteractionHost service={activeService} /> : null}

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

      <Box marginTop={1}>
        <KeyHintBar hints={footerHints(route, paletteOpen)} />
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

function footerHints(route: TTerminalRoute, paletteOpen: boolean): { key: string; label: string }[] {
  if (paletteOpen) {
    return [
      { key: "↑↓", label: "Navigate" },
      { key: "Enter", label: "Select" },
      { key: "Esc", label: "Close" },
    ];
  }

  if (route.screen === "workflow") {
    return [
      { key: "Ctrl+C", label: "Cancel" },
      { key: "Enter", label: "Expand output" },
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
