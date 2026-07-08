import { useEffect, useState } from "react";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { Spinner } from "../common/Spinner";
import { studioApi } from "../../api/studio-api-client";
import { highlightMatch } from "../../lib/highlight-match";
import type { TCloudFoundryApp } from "../../api/studio-api-types";

export function BtpAppSelector({
  targetKey,
  targetLabel,
  onSelect,
  onBack,
}: {
  targetKey: string;
  targetLabel: string;
  onSelect: (appName: string) => void;
  onBack: () => void;
}): React.ReactElement {
  const [apps, setApps] = useState<TCloudFoundryApp[] | null>(null);
  const [error, setError] = useState("");
  const [cacheStatus, setCacheStatus] = useState("");
  const [warning, setWarning] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = (refresh = false): void => {
    setLoading(true);
    studioApi
      .getBtpApps(targetKey, refresh)
      .then((response) => {
        if (response.error && !response.apps?.length) {
          setError(response.error);
          setApps([]);
        } else {
          setError("");
          setApps(response.apps ?? []);
          setCacheStatus(response.cacheStatus);
          setWarning(response.warning);
        }
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  const lowerQ = search.toLowerCase();
  const filtered = (apps ?? []).filter((app) => (app.name ?? "").toLowerCase().includes(lowerQ) || (app.routes ?? "").toLowerCase().includes(lowerQ));

  return (
    <div>
      <div className="wiz-breadcrumb" style={{ marginBottom: 8 }}>
        <span className="crumb" onClick={onBack}>
          Targets
        </span>
        <span className="sep"> › </span>
        <span>{targetLabel}</span>
      </div>
      <div className="note" style={{ marginBottom: 8 }}>
        Selected target: <b>{targetLabel}</b>
      </div>

      {loading ? (
        <EmptyState>
          <Spinner /> loading apps from {targetLabel}...
        </EmptyState>
      ) : error ? (
        <>
          <div className="errbox">
            <div>Cannot load apps for {targetLabel}.</div>
            <div style={{ marginTop: 4 }}>{error}</div>
            <div className="note" style={{ marginTop: 6 }}>
              Action: run smdg cf login, or refresh the target cache.
            </div>
          </div>
          <div className="row right" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={onBack}>
              ◁ Back
            </Button>
            <Button variant="sec" onClick={() => load(true)}>
              ⟳ Retry
            </Button>
          </div>
        </>
      ) : (
        <>
          {cacheStatus && cacheStatus !== "fresh" ? (
            <div className="note" style={{ marginBottom: 6 }}>
              <span className={`cbadge ${cacheStatus}`}>{cacheStatus}</span>
              {warning ? <span style={{ marginLeft: 6 }}>{warning}</span> : null}
            </div>
          ) : null}
          <div className="field" style={{ marginBottom: 8 }}>
            <input className="input" placeholder="Search apps..." value={search} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div className="wiz-body" style={{ maxHeight: 340, overflow: "auto" }}>
            {!filtered.length ? (
              <EmptyState>{search ? "No apps match your search." : "No apps found in this space."}</EmptyState>
            ) : (
              filtered.map((app) => (
                <div key={app.name} className="trow" onClick={() => onSelect(app.name)}>
                  <div className="trow-icon">▸</div>
                  <div className="trow-main">
                    <div className="trow-title">{highlightMatch(app.name, search)}</div>
                    <div className="trow-meta">
                      {app.requestedState ?? ""}
                      {app.processes ? ` · ${app.processes}` : ""}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="row right" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={onBack}>
              ◁ Back
            </Button>
            <Button variant="sec" onClick={() => load(true)}>
              ⟳ Refresh
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
