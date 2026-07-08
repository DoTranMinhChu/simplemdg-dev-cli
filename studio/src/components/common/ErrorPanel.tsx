import { useState } from "react";
import { Button } from "./Button";

export type TRecoveryAction = "retry" | "reconnect" | "refresh-from-btp" | "close-connection";

export type TPanelError = {
  message: string;
  kind?: string;
  technicalMessage?: string;
  recoveryActions?: TRecoveryAction[];
};

export function ErrorPanel({
  title,
  error,
  onRetry,
  onReconnect,
  onRefreshFromBtp,
  onCloseConnection,
  canRefreshFromBtp,
}: {
  title: string;
  error: TPanelError;
  onRetry?: () => void;
  onReconnect?: () => void;
  onRefreshFromBtp?: () => void;
  onCloseConnection?: () => void;
  canRefreshFromBtp?: boolean;
}): React.ReactElement {
  const [showDetails, setShowDetails] = useState(false);
  const actions = error.recoveryActions ?? ["retry", "reconnect", "refresh-from-btp"];

  return (
    <div className="errbox adapter-err">
      <div style={{ fontWeight: 600 }}>{title}</div>
      <div className="note" style={{ marginTop: 4 }}>
        {error.kind ? `${error.kind} — ` : ""}
        {error.message}
      </div>
      <div className="row" style={{ marginTop: 8, gap: 6, flexWrap: "wrap" }}>
        {actions.includes("retry") && onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {actions.includes("reconnect") && onReconnect ? (
          <Button size="sm" variant="sec" onClick={onReconnect}>
            Reconnect
          </Button>
        ) : null}
        {actions.includes("refresh-from-btp") && onRefreshFromBtp && canRefreshFromBtp ? (
          <Button size="sm" variant="sec" onClick={onRefreshFromBtp}>
            Refresh credentials from BTP
          </Button>
        ) : null}
        {actions.includes("close-connection") && onCloseConnection ? (
          <Button size="sm" variant="ghost" onClick={onCloseConnection}>
            Close connection
          </Button>
        ) : null}
      </div>
      {error.technicalMessage ? (
        <div style={{ marginTop: 8 }}>
          <a className="link" onClick={() => setShowDetails((prev) => !prev)}>
            {showDetails ? "Hide technical details" : "Show technical details"}
          </a>
          {showDetails ? <pre className="cell-pre wrap note" style={{ marginTop: 6 }}>{error.technicalMessage}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
