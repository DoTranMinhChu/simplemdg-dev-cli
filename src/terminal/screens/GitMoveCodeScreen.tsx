import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import { Stepper } from "../components/Stepper";
import { useTerminalTheme } from "../hooks/useTerminalTheme";
import { resolveRepositoryPath } from "../../core/repository";
import { buildMoveCodeInput } from "../../commands/git.command";
import { runMoveCodeWorkflow } from "../../core/git/git-move-code-workflow";
import { InteractionCancelledError } from "../../core/interaction/interaction-service";
import type { InkInteractionService } from "../services/ink-interaction-service";
import type { TWorkflowContext } from "../../core/git/git-types";
import type { TNotification } from "../../core/interaction/interaction-service";

const STEP_LABELS = [
  "Fetch branches",
  "Search commits",
  "Select commits",
  "Create release branch",
  "Cherry-pick",
  "Build",
  "Trace dependencies",
  "Summary",
];

/**
 * The flagship migrated workflow: same `runMoveCodeWorkflow`/`buildMoveCodeInput`
 * business logic the traditional `smdg git move-code` command calls, fed by an
 * InkInteractionService instead of PlainCliInteractionService. Every
 * select/input/confirm/multiSelect touchpoint renders via <InteractionHost/>
 * (mounted alongside this screen by SmdgTerminalApp); every notify() call
 * lands in the shell's permanent scrollback — that stream is this screen's
 * source of truth for what happened, so there's no separate summary to keep
 * in sync.
 */
export function GitMoveCodeScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const theme = useTerminalTheme();
  const [stepIndex, setStepIndex] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    const onNotify = (notification: TNotification) => {
      if (notification.level === "step" && notification.current !== undefined) {
        setStepIndex(notification.current - 1);
      }
    };
    props.service.on("notify", onNotify);
    return () => {
      props.service.off("notify", onNotify);
    };
  }, [props.service]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ctx: TWorkflowContext = { interaction: props.service, signal: props.service.signal };

    void (async () => {
      try {
        const repositoryPath = await resolveRepositoryPath(process.cwd());
        const input = await buildMoveCodeInput({}, ctx);
        const results = await runMoveCodeWorkflow(input, [repositoryPath], ctx);
        const failed = results.some((result) => result.status === "CONFLICT" || result.status === "ABORTED");
        props.onDone(!failed);
      } catch (error) {
        if (!(error instanceof InteractionCancelledError) && !props.service.signal.aborted) {
          props.service.notify({ level: "error", message: error instanceof Error ? error.message : String(error) });
        }
        props.onDone(false);
      }
    })();
    // Intentionally runs once per mount — a fresh GitMoveCodeScreen instance
    // (and a fresh InkInteractionService/AbortController) is created per launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box flexDirection="column">
      <Text bold color={theme.primary || undefined}>
        Move Code Assistant
      </Text>
      <Box marginY={1}>
        <Stepper steps={STEP_LABELS} currentIndex={stepIndex} />
      </Box>
    </Box>
  );
}
