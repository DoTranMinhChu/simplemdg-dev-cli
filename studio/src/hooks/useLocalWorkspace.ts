import { useCallback, useRef } from "react";
import { studioApi } from "../api/studio-api-client";
import type { TStudioWorkspaceState } from "../api/studio-api-types";

/**
 * Persist workspace state (tabs, layout) to the backend file cache
 * (~/.simplemdg/db-studio-workspace.json) with a debounce, mirroring the
 * legacy client's `scheduleWorkspaceSave`. The workspace store calls
 * `scheduleSave` after every mutation; calls within `delayMs` collapse into
 * one write.
 */
export function useLocalWorkspace(delayMs = 500): {
  scheduleSave: (workspace: TStudioWorkspaceState) => void;
  loadWorkspace: () => Promise<TStudioWorkspaceState | null>;
} {
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const scheduleSave = useCallback(
    (workspace: TStudioWorkspaceState) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        studioApi.saveWorkspace(workspace).catch(() => undefined);
      }, delayMs);
    },
    [delayMs],
  );

  const loadWorkspace = useCallback(async () => {
    const response = await studioApi.getWorkspace();
    return response.workspace;
  }, []);

  return { scheduleSave, loadWorkspace };
}
