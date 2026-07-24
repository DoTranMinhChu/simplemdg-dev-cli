import React, { useEffect, useRef } from "react";
import { Text } from "ink";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { InteractionCancelledError } from "../../core/interaction/interaction-service";
import type { TInteractionContext } from "../../core/interaction/interaction-service";
import type { InkInteractionService } from "../services/ink-interaction-service";

/**
 * Generic native screen for a command whose business logic ALREADY accepts
 * `ctx: TInteractionContext` and calls `ctx.interaction.*`/`ctx.interaction.notify`
 * exclusively (e.g. the `cf region *` commands) — generalizes the pattern
 * `CfOrgScreen.tsx`/`GitMoveCodeScreen.tsx` hand-wrote. No re-implementation
 * of prompts needed: `<InteractionHost/>` (mounted alongside this screen by
 * SmdgTerminalApp) renders whatever the function's own `ctx.interaction.*`
 * calls request.
 */
export function makeCtxWorkflowScreen(
  run: (ctx: TInteractionContext) => Promise<void>,
  title: string,
): React.ComponentType<{ service: InkInteractionService; onDone: (success: boolean) => void }> {
  return function CtxWorkflowScreen(props) {
    const theme = useTerminalTheme();
    const startedRef = useRef(false);

    useEffect(() => {
      if (startedRef.current) return;
      startedRef.current = true;

      const ctx: TInteractionContext = { interaction: props.service, signal: props.service.signal };

      void (async () => {
        try {
          await run(ctx);
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
        {title}
      </Text>
    );
  };
}
