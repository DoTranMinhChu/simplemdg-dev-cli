import { useEffect, useState } from "react";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { Spinner } from "../common/Spinner";
import { studioApi } from "../../api/studio-api-client";
import type { TDatabaseServiceCandidate } from "../../api/studio-api-types";

export function BtpDatabaseServiceSelector({
  targetKey,
  appName,
  targetLabel,
  onSelect,
  onBack,
}: {
  targetKey: string;
  appName: string;
  targetLabel: string;
  onSelect: (candidate: TDatabaseServiceCandidate) => void;
  onBack: () => void;
}): React.ReactElement {
  const [candidates, setCandidates] = useState<TDatabaseServiceCandidate[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = (refresh = false): void => {
    setLoading(true);
    studioApi
      .getBtpDbCandidates(targetKey, appName, refresh)
      .then((response) => {
        if (response.error && !response.candidates?.length) setError(response.error);
        else setError("");
        setCandidates(response.candidates ?? []);
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, appName]);

  return (
    <div>
      <div className="wiz-breadcrumb" style={{ marginBottom: 8 }}>
        <span className="crumb" onClick={onBack}>
          {targetLabel}
        </span>
        <span className="sep"> › </span>
        <span>{appName}</span>
      </div>

      {loading ? (
        <EmptyState>
          <Spinner /> detecting database services in {appName}...
        </EmptyState>
      ) : error ? (
        <>
          <div className="errbox">
            <div>Cannot read env for {appName}.</div>
            <div style={{ marginTop: 4 }}>{error}</div>
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
      ) : !candidates?.length ? (
        <>
          <EmptyState>No HANA/PostgreSQL service bindings detected for this app.</EmptyState>
          <div className="row right" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={onBack}>
              ◁ Back
            </Button>
            <Button variant="sec" onClick={() => load(true)}>
              ⟳ Refresh
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="wiz-body" style={{ maxHeight: 340, overflow: "auto" }}>
            {candidates.map((candidate) => (
              <div key={candidate.serviceName} className="trow" onClick={() => onSelect(candidate)}>
                <div className="trow-icon">{candidate.type === "hana" ? "H" : "P"}</div>
                <div className="trow-main">
                  <div className="trow-title">{candidate.label}</div>
                  <div className="trow-meta">
                    {candidate.serviceName}
                    {candidate.servicePlan ? ` · ${candidate.servicePlan}` : ""} · {candidate.host}:{candidate.port}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="row right" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={onBack}>
              ◁ Back
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
