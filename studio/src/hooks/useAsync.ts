import { useCallback, useRef, useState } from "react";

export type TAsyncState<T> = {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
};

/**
 * Wraps an async action with loading/error/data state. `run` can be called
 * repeatedly (e.g. on retry); a stale in-flight call whose result arrives
 * after a newer call was started is ignored.
 */
export function useAsync<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
): TAsyncState<TResult> & { run: (...args: TArgs) => Promise<TResult | undefined>; reset: () => void } {
  const [state, setState] = useState<TAsyncState<TResult>>({ data: undefined, error: undefined, loading: false });
  const callId = useRef(0);

  const run = useCallback(
    async (...args: TArgs) => {
      const id = ++callId.current;
      setState((prev) => ({ ...prev, loading: true, error: undefined }));

      try {
        const data = await action(...args);
        if (id === callId.current) setState({ data, error: undefined, loading: false });
        return data;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (id === callId.current) setState((prev) => ({ ...prev, error: message, loading: false }));
        return undefined;
      }
    },
    [action],
  );

  // Invalidates any in-flight `run` (its result, once it arrives, is ignored) and clears state back
  // to initial — used when upstream selections change and a previous result would otherwise show
  // as if it were still current (e.g. a stale file-change preview from a since-replaced upload).
  const reset = useCallback(() => {
    callId.current++;
    setState({ data: undefined, error: undefined, loading: false });
  }, []);

  return { ...state, run, reset };
}
