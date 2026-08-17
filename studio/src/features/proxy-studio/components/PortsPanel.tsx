import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { useAsync } from "../../../hooks/useAsync";
import { proxyStudioApi } from "../api/proxy-studio-api-client";
import { useProxyEvents } from "../hooks/useProxyEvents";

/** Every port currently bound by an environment or a quick proxy, with a kill action — mirrors the reference project's "Ports In Use" dialog. Collapsed by default (a compact pill) so it doesn't take up space when nobody's looking at it; click to expand the chip list. */
export function PortsPanel(): React.ReactElement {
  const ports = useAsync(() => proxyStudioApi.listPorts());
  const [expanded, setExpanded] = useState(false);
  const [killError, setKillError] = useState("");

  useEffect(() => {
    void ports.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useProxyEvents((event) => {
    if (event.channel === "status") void ports.run();
  });

  const rows = ports.data?.ports ?? [];

  if (!expanded) {
    return (
      <button type="button" className="proxy-ports-pill" onClick={() => setExpanded(true)} title="Show what's currently running">
        🔌 {rows.length > 0 ? `Running (${rows.length})` : "Running now"}
      </button>
    );
  }

  return (
    <div className="ts-card" style={{ marginTop: 12, marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Running now{rows.length > 0 ? ` (${rows.length})` : ""}</strong>
        <div className="row">
          <Button variant="ghost" size="sm" onClick={() => void ports.run()} disabled={ports.loading}>
            {ports.loading ? <Spinner /> : "Refresh"}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
            Hide
          </Button>
        </div>
      </div>

      {killError ? <div className="errbox" style={{ marginTop: 8 }}>{killError}</div> : null}

      {rows.length === 0 ? (
        <p className="note" style={{ marginTop: 8 }}>Nothing bound right now.</p>
      ) : (
        <div className="proxy-port-row" style={{ marginTop: 8 }}>
          {rows.map((row) => (
            <span key={row.port} className="port-chip" title={`${row.ownerName} (${row.type})`}>
              :{row.port} {row.ownerName}
              <button
                type="button"
                className="port-chip-stop"
                title={`Stop port ${row.port}`}
                onClick={async () => {
                  setKillError("");
                  try {
                    await proxyStudioApi.killPort(row.port);
                    void ports.run();
                  } catch (error) {
                    // Previously unhandled — a race (two tabs, or the process already exited
                    // between the list refresh and this click) threw an uncaught rejection with
                    // zero visible feedback; the button just silently did nothing.
                    setKillError(error instanceof Error ? error.message : String(error));
                  }
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
