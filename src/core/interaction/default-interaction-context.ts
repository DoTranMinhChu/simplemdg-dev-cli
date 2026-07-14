import { PlainCliInteractionService } from "./plain-cli-interaction-service";
import type { TInteractionContext } from "./interaction-service";

/**
 * Lazily-created, per-process default context for traditional (non-shell)
 * Commander dispatch: today's exact `prompts`/`console.log` behavior via
 * `PlainCliInteractionService`, plus a real `AbortController` wired to SIGINT
 * so Ctrl+C actually kills an in-flight child process instead of being
 * ignored. Memoized because every CLI invocation is its own short-lived
 * process — one shared context per process is simpler and safer than a fresh
 * one (and a fresh SIGINT listener) per call.
 */
let sharedDefaultContext: TInteractionContext | undefined;

export function getDefaultInteractionContext(): TInteractionContext {
  if (!sharedDefaultContext) {
    const controller = new AbortController();
    process.once("SIGINT", () => controller.abort());
    sharedDefaultContext = { interaction: new PlainCliInteractionService(), signal: controller.signal };
  }

  return sharedDefaultContext;
}
