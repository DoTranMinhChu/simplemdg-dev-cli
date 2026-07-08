import { useEffect } from "react";

export type TKeyboardShortcut = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  handler: (event: KeyboardEvent) => void;
  /** Skip this shortcut while focus is inside an input/textarea/contentEditable. */
  ignoreWhenTyping?: boolean;
};

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable));
}

export function useKeyboardShortcuts(shortcuts: TKeyboardShortcut[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      for (const shortcut of shortcuts) {
        const ctrlMatches = Boolean(shortcut.ctrl) === (event.ctrlKey || event.metaKey);
        const shiftMatches = Boolean(shortcut.shift) === event.shiftKey;
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();

        if (keyMatches && ctrlMatches && shiftMatches) {
          if (shortcut.ignoreWhenTyping && isTyping(event.target)) continue;
          shortcut.handler(event);
          return;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shortcuts]);
}
