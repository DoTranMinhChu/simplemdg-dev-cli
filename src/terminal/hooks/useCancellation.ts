import { useCallback, useRef, useState } from "react";

/** Manages the AbortController for whatever workflow is currently running in the shell. */
export function useCancellation() {
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const [isRunning, setIsRunning] = useState(false);

  const begin = useCallback((): AbortController => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsRunning(true);
    return controller;
  }, []);

  const end = useCallback(() => {
    controllerRef.current = undefined;
    setIsRunning(false);
  }, []);

  const cancel = useCallback((): boolean => {
    if (!controllerRef.current || controllerRef.current.signal.aborted) {
      return false;
    }
    controllerRef.current.abort();
    return true;
  }, []);

  return { begin, end, cancel, isRunning };
}
