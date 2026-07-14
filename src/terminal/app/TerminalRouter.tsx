import React from "react";
import { HomeScreen } from "../screens/HomeScreen";
import { GitMoveCodeScreen } from "../screens/GitMoveCodeScreen";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TCommandHistoryEntry } from "../services/command-history";
import type { TToolCheck } from "../services/context-facts";
import type { InkInteractionService } from "../services/ink-interaction-service";

export type TTerminalRoute = { screen: "home" } | { screen: "workflow"; commandId: string };

export function TerminalRouter(props: {
  route: TTerminalRoute;
  commands: TInteractiveCommandDefinition[];
  recent: TCommandHistoryEntry[];
  toolChecklist: TToolCheck[];
  activeService: InkInteractionService | undefined;
  onWorkflowDone: (success: boolean) => void;
}) {
  if (props.route.screen === "workflow" && props.route.commandId === "git.move-code" && props.activeService) {
    return <GitMoveCodeScreen service={props.activeService} onDone={props.onWorkflowDone} />;
  }

  return <HomeScreen commands={props.commands} recent={props.recent} toolChecklist={props.toolChecklist} />;
}
