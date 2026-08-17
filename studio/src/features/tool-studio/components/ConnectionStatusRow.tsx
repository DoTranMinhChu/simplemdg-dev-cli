import { useState } from "react";
import { CfLoginModal } from "../../../components/btp/CfLoginModal";
import { GitLabLoginModal } from "./GitLabLoginModal";
import { useToolAuthStatus } from "../state/tool-auth-status";

/**
 * Always-visible CF + GitLab connection state in the nav — before this, Tool Studio only ever
 * found out it wasn't connected when an action failed deep inside some page (e.g.
 * BtpTargetSelector's "No cached targets found. Run: smdg cf apps"), with no way to fix it
 * without leaving the browser for a terminal. Both pills are live (auto-rechecked — see
 * tool-auth-status.tsx) and clickable when disconnected, opening the same in-app login DB Studio
 * already has for CF, plus a new one here for GitLab.
 */
export function ConnectionStatusRow(): React.ReactElement {
  const { cfStatus, gitlabStatus, refreshCfStatus, refreshGitlabStatus, setCfOfflineMode } = useToolAuthStatus();
  const [loginTarget, setLoginTarget] = useState<"cf" | "gitlab" | null>(null);

  const cfConnected = cfStatus?.isLoggedIn ?? false;
  const gitlabConnected = gitlabStatus?.isLoggedIn ?? false;

  return (
    <div className="ts-conn-status">
      <button
        type="button"
        className={`ts-conn-pill${cfConnected ? " ok" : ""}`}
        onClick={() => {
          if (!cfConnected) setLoginTarget("cf");
        }}
        title={cfConnected ? `Cloud Foundry — connected as ${cfStatus?.cachedUsername ?? "unknown user"}` : "Not connected to Cloud Foundry — click to log in"}
      >
        <span className="ts-conn-dot" />
        Cloud Foundry
      </button>
      <button
        type="button"
        className={`ts-conn-pill${gitlabConnected ? " ok" : ""}`}
        onClick={() => {
          if (!gitlabConnected) setLoginTarget("gitlab");
        }}
        title={gitlabConnected ? `GitLab — connected as ${gitlabStatus?.username ?? "unknown user"}` : "Not connected to GitLab — click to log in"}
      >
        <span className="ts-conn-dot" />
        GitLab
      </button>

      {loginTarget === "cf" ? (
        <CfLoginModal
          onClose={() => setLoginTarget(null)}
          onSuccess={() => setLoginTarget(null)}
          hooks={{ cfStatus, refreshCfStatus, setCfOfflineMode }}
        />
      ) : null}
      {loginTarget === "gitlab" ? (
        <GitLabLoginModal
          onClose={() => setLoginTarget(null)}
          onSuccess={() => {
            setLoginTarget(null);
            void refreshGitlabStatus();
          }}
        />
      ) : null}
    </div>
  );
}
