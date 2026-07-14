import React from "react";
import { HomeScreen } from "../screens/HomeScreen";
import { GitMoveCodeScreen } from "../screens/GitMoveCodeScreen";
import { CfOrgScreen } from "../screens/CfOrgScreen";
import type { TInteractiveCommandDefinition } from "../services/command-registry";
import type { TCommandHistoryEntry } from "../services/command-history";
import type { TToolCheck } from "../services/context-facts";
import type { InkInteractionService } from "../services/ink-interaction-service";

export type TTerminalRoute = { screen: "home" } | { screen: "workflow"; commandId: string };

/** Every "native" command's bespoke screen, keyed by registry id. */
const NATIVE_SCREENS: Record<string, React.ComponentType<{ service: InkInteractionService; onDone: (success: boolean) => void }>> = {
  "git.move-code": GitMoveCodeScreen,
  "cf.org": CfOrgScreen,
};

export function TerminalRouter(props: {
  route: TTerminalRoute;
  commands: TInteractiveCommandDefinition[];
  recent: TCommandHistoryEntry[];
  toolChecklist: TToolCheck[];
  activeService: InkInteractionService | undefined;
  onWorkflowDone: (success: boolean) => void;
}) {
  if (props.route.screen === "workflow" && props.activeService) {
    const Screen = NATIVE_SCREENS[props.route.commandId];
    if (Screen) {
      return <Screen service={props.activeService} onDone={props.onWorkflowDone} />;
    }
  }

  return <HomeScreen commands={props.commands} recent={props.recent} toolChecklist={props.toolChecklist} />;
}
