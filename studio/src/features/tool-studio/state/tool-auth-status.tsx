import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCfAuthStatus } from "../../../api/studio-api-types";

export type TGitlabAuthStatus = { isLoggedIn: boolean; username?: string; name?: string; baseUrl?: string; expiresAt?: string | null };

type TToolAuthStatusValue = {
  cfStatus: TCfAuthStatus | null;
  cfOfflineMode: boolean;
  setCfOfflineMode: (value: boolean) => void;
  refreshCfStatus: () => Promise<void>;
  gitlabStatus: TGitlabAuthStatus | null;
  refreshGitlabStatus: () => Promise<void>;
};

const ToolAuthStatusContext = createContext<TToolAuthStatusValue | undefined>(undefined);

/**
 * CF login and GitLab login both happen OUTSIDE the browser today — a terminal running
 * `smdg cf login`/`smdg gitlab login`, or a saved session simply expiring on its own. There's no
 * event the backend can push for either of those, so this polls `cf orgs`/GitLab's `/user`
 * endpoint instead of using SSE (unlike deploy-job progress, see useJobEvents.ts). 3 minutes
 * balances "notice a re-login reasonably fast" against not hammering either endpoint on every tab
 * left open in the background; a `visibilitychange`/`focus` recheck on top of that catches the
 * single most common case immediately — tab away to a terminal, log in, tab back — without
 * waiting for the next interval tick.
 */
const AUTO_RECHECK_INTERVAL_MS = 3 * 60 * 1000;

export function ToolAuthStatusProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [cfStatus, setCfStatus] = useState<TCfAuthStatus | null>(null);
  const [cfOfflineMode, setCfOfflineMode] = useState(false);
  const [gitlabStatus, setGitlabStatus] = useState<TGitlabAuthStatus | null>(null);

  const refreshCfStatus = useCallback(async () => {
    try {
      setCfStatus(await toolStudioApi.getCfAuthStatus());
    } catch {
      setCfStatus(null);
    }
  }, []);

  const refreshGitlabStatus = useCallback(async () => {
    try {
      setGitlabStatus(await toolStudioApi.getGitlabAuthStatus());
    } catch {
      setGitlabStatus(null);
    }
  }, []);

  useEffect(() => {
    void refreshCfStatus();
    void refreshGitlabStatus();

    const interval = window.setInterval(() => {
      void refreshCfStatus();
      void refreshGitlabStatus();
    }, AUTO_RECHECK_INTERVAL_MS);

    const onVisible = (): void => {
      if (document.visibilityState !== "visible") return;
      void refreshCfStatus();
      void refreshGitlabStatus();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshCfStatus, refreshGitlabStatus]);

  const value: TToolAuthStatusValue = { cfStatus, cfOfflineMode, setCfOfflineMode, refreshCfStatus, gitlabStatus, refreshGitlabStatus };
  return <ToolAuthStatusContext.Provider value={value}>{children}</ToolAuthStatusContext.Provider>;
}

export function useToolAuthStatus(): TToolAuthStatusValue {
  const context = useContext(ToolAuthStatusContext);
  if (!context) throw new Error("useToolAuthStatus must be used inside ToolAuthStatusProvider");
  return context;
}
