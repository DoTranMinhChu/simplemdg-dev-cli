import React, { useEffect, useRef } from "react";
import { Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { runOrgCommand } from "../../commands/cf.command";
import { InteractionCancelledError } from "../../core/interaction/interaction-service";
import type { InkInteractionService } from "../services/ink-interaction-service";
import type { TInteractionContext } from "../../core/interaction/interaction-service";

/**
 * Native migration of `smdg cf org` (the CF target switcher, favorites, and
 * region management menus). Same `runOrgCommand` business logic the
 * traditional command calls, fed by an InkInteractionService instead of
 * PlainCliInteractionService — every select/input/confirm/multiSelect
 * touchpoint renders via <InteractionHost/> (mounted alongside this screen by
 * SmdgTerminalApp), every notify() call lands in the shell's permanent
 * scrollback. No `prompts` library involved at all, so the confirm-prompt
 * crash on an unrecognized keypress (arrow key, paste, etc.) cannot occur.
 */
export function CfOrgScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const theme = useTerminalTheme();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ctx: TInteractionContext = { interaction: props.service, signal: props.service.signal };

    void (async () => {
      try {
        await runOrgCommand({}, ctx);
        props.onDone(true);
      } catch (error) {
        if (!(error instanceof InteractionCancelledError) && !props.service.signal.aborted) {
          props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
        }
        props.onDone(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Text bold color={theme.primary || undefined}>
      Cloud Foundry
    </Text>
  );
}
