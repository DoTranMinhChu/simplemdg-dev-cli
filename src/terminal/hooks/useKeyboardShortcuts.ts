import { useInput } from "ink";

export type TGlobalShortcutHandlers = {
  onPalette?: () => void; // Ctrl+K
  onHistorySearch?: () => void; // Ctrl+R
  onRecent?: () => void; // Ctrl+P
  onClear?: () => void; // Ctrl+L
  onCancelOrExit?: () => void; // Ctrl+C — meaning depends on whether a workflow is running
  onCycleSession?: () => void; // Ctrl+N — cycle focus across running sessions + home
};

/**
 * Registered once at the shell root. Only reacts to Ctrl+<letter> combinations,
 * so it never conflicts with CommandInput's own plain-character handling —
 * Ctrl-chords are never valid text input, so both hooks can stay active
 * simultaneously without stepping on each other.
 */
export function useGlobalShortcuts(handlers: TGlobalShortcutHandlers, options?: { isActive?: boolean }): void {
  useInput(
    (input, key) => {
      if (!key.ctrl) {
        return;
      }

      switch (input) {
        case "k":
          handlers.onPalette?.();
          return;
        case "r":
          handlers.onHistorySearch?.();
          return;
        case "p":
          handlers.onRecent?.();
          return;
        case "l":
          handlers.onClear?.();
          return;
        case "c":
          handlers.onCancelOrExit?.();
          return;
        case "n":
          handlers.onCycleSession?.();
          return;
        default:
      }
    },
    { isActive: options?.isActive ?? true },
  );
}
