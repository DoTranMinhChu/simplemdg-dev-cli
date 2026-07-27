import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { Modal } from "../../../components/common/Modal";
import { studioApi } from "../../../api/studio-api-client";
import type { TCfTargetSummary, TGetBtpTargetsResponse } from "../../../api/studio-api-types";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TAuditLogDiscoveryCandidate } from "../api/tool-studio-api-client";
import { useJobEvents, mergeJobSteps } from "../hooks/useJobEvents";
import type { TJobStep } from "../hooks/useJobEvents";

function newJobId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Checkbox-list variant of BtpTargetSelector — that component is single-select only, and this feature needs to register several subaccounts from one Global Account at once. Reuses the same `/api/btp/targets` data. */
function BtpMultiSelect({ selectedKeys, onToggle }: { selectedKeys: Set<string>; onToggle: (target: TCfTargetSummary) => void }): React.ReactElement {
  const [data, setData] = useState<TGetBtpTargetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");

  const load = (): void => {
    studioApi
      .getBtpTargets()
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <EmptyState>
        <Spinner /> loading BTP targets...
      </EmptyState>
    );
  }
  if (!data) return <EmptyState>No data. Run: smdg cf login</EmptyState>;

  const lowerQ = search.toLowerCase();
  const allTargets: TCfTargetSummary[] = [...data.favorites, ...data.recent, ...Object.values(data.byRegion).flat()];
  const byKey = new Map(allTargets.map((target) => [target.key, target]));
  const uniqueTargets = Array.from(byKey.values())
    .filter((target) => !lowerQ || `${target.org} ${target.space} ${target.region} ${target.environment ?? ""}`.toLowerCase().includes(lowerQ))
    .sort((left, right) => left.region.localeCompare(right.region) || left.org.localeCompare(right.org) || left.space.localeCompare(right.space));

  return (
    <div>
      <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
        <input className="input" style={{ flex: 1 }} placeholder="Search org / space / region..." value={search} onChange={(event) => setSearch(event.target.value)} />
        <Button
          variant="sec"
          size="sm"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void studioApi
              .refreshBtpTargets()
              .then(load)
              .finally(() => setRefreshing(false));
          }}
        >
          {refreshing ? <Spinner /> : "⟳ Rescan BTP"}
        </Button>
      </div>
      <div className="note" style={{ marginBottom: 8 }}>
        {uniqueTargets.length} known org/space targets{data.lastUpdatedAgo ? ` · scanned ${data.lastUpdatedAgo}` : ""}. Check every subaccount you want monitored — you can select several projects/environments at once.
      </div>
      <div className="wiz-body" style={{ maxHeight: 320, overflow: "auto" }}>
        {uniqueTargets.map((target) => (
          <label key={target.key} className="trow" style={{ cursor: "pointer" }}>
            <input type="checkbox" checked={selectedKeys.has(target.key)} onChange={() => onToggle(target)} style={{ marginRight: 8, flex: "none" }} />
            <div className="trow-main">
              <div className="trow-title">
                {target.org} / {target.space}
              </div>
              <div className="trow-meta">
                {target.region}
                {target.environment ? ` · ${target.environment}` : ""}
              </div>
            </div>
          </label>
        ))}
        {!uniqueTargets.length && <EmptyState>{lowerQ ? "No targets match your search." : "No cached targets found. Run: smdg cf apps"}</EmptyState>}
      </div>
    </div>
  );
}

function CandidateRow({ candidate, onSave }: { candidate: TAuditLogDiscoveryCandidate; onSave: (input: { projectName: string; envLabel: string }) => Promise<void> }): React.ReactElement {
  const [projectName, setProjectName] = useState(candidate.suggestedProjectName);
  const [envLabel, setEnvLabel] = useState(candidate.suggestedEnvLabel);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (candidate.status !== "ready") {
    return (
      <div className="ts-card" style={{ padding: "var(--space-3)", marginBottom: 8 }}>
        <div className="row" style={{ alignItems: "baseline" }}>
          <b style={{ flex: 1 }}>
            {candidate.org} / {candidate.space} ({candidate.region})
          </b>
          <span className="cbadge expired">{candidate.status}</span>
        </div>
        <div className="note" style={{ marginTop: 4 }}>
          {candidate.status === "no-app-found" && "No apps found in this space."}
          {candidate.status === "no-db-found" && `Tried ${candidate.triedAppCount ?? 0} app(s) — none had a HANA/PostgreSQL binding.`}
          {candidate.status === "error" && candidate.error}
        </div>
      </div>
    );
  }

  if (saved) {
    return (
      <div className="ts-card" style={{ padding: "var(--space-3)", marginBottom: 8 }}>
        <span className="cbadge fresh">Saved</span> {projectName} / {envLabel}
      </div>
    );
  }

  return (
    <div className="ts-card" style={{ padding: "var(--space-3)", marginBottom: 8 }}>
      <div className="note" style={{ marginBottom: 8 }}>
        {candidate.org} / {candidate.space} ({candidate.region}) — app <code>{candidate.appName}</code>, {candidate.databaseType} service <code>{candidate.serviceName}</code>
      </div>
      <div className="ts-grid-2">
        <div className="field">
          <label>Project name</label>
          <input className="input" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
        </div>
        <div className="field">
          <label>Environment label</label>
          <input className="input" value={envLabel} onChange={(event) => setEnvLabel(event.target.value)} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <Button
          size="sm"
          disabled={saving || !projectName || !envLabel}
          onClick={() => {
            setSaving(true);
            void onSave({ projectName, envLabel }).then(() => {
              setSaving(false);
              setSaved(true);
            });
          }}
        >
          {saving ? <Spinner /> : "Save environment"}
        </Button>
      </div>
    </div>
  );
}

/** "Pick subaccounts from BTP" + "Review & save" flow, extracted out of AuditLogEnvironmentsTab so
 * the tab itself can be list-first (registered environments up front) with this as an on-demand
 * modal instead of always-visible form. */
export function AddAuditLogEnvironmentModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): React.ReactElement {
  const [selected, setSelected] = useState<Map<string, TCfTargetSummary>>(new Map());
  const [jobId, setJobId] = useState<string | undefined>();
  const [steps, setSteps] = useState<TJobStep[]>([]);
  const [candidates, setCandidates] = useState<TAuditLogDiscoveryCandidate[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useJobEvents(jobId, (event) => {
    if (event.steps) setSteps((prev) => mergeJobSteps(prev, event.steps!));
    if (event.type === "job-completed") setDiscovering(false);
  });

  const toggle = (target: TCfTargetSummary): void => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(target.key)) next.delete(target.key);
      else next.set(target.key, target);
      return next;
    });
  };

  const discover = async (): Promise<void> => {
    const targetKeys = Array.from(selected.keys());
    if (!targetKeys.length) return;
    const id = newJobId();
    setJobId(id);
    setSteps(targetKeys.map((key) => ({ key, label: key, status: "pending" })));
    setCandidates([]);
    setError(undefined);
    setDiscovering(true);
    const response = await toolStudioApi.discoverAuditLogEnvironments({ targetKeys, jobId: id });
    if (response.error) setError(response.error);
    setCandidates(response.candidates);
    setDiscovering(false);
  };

  return (
    <Modal onClose={onClose} width={760}>
      <h3 style={{ marginTop: 0 }}>Add environment(s)</h3>

      <h2 style={{ marginTop: 0 }}>1. Pick subaccounts from BTP</h2>
      <div className="ts-card">
        <BtpMultiSelect selectedKeys={new Set(selected.keys())} onToggle={toggle} />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="note" style={{ flex: 1 }}>{selected.size} selected</span>
          <Button disabled={!selected.size || discovering} onClick={() => void discover()}>
            {discovering ? <Spinner /> : `Discover credentials for ${selected.size || ""} target(s)`}
          </Button>
        </div>
      </div>

      {discovering && (
        <div className="ts-card" style={{ marginTop: 12 }}>
          {steps.map((step) => (
            <div key={step.key} className="row" style={{ gap: 8, padding: "2px 0" }}>
              <span className={`cbadge ${step.status === "success" ? "fresh" : step.status === "failed" ? "expired" : step.status === "running" ? "refreshing" : "missing"}`}>{step.status}</span>
              <span>{step.label}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="errbox" style={{ marginTop: 12 }}>{error}</div>}

      {candidates.length > 0 && (
        <>
          <h2>2. Review &amp; save</h2>
          <p className="note" style={{ marginTop: 0 }}>
            Each app's HANA/PostgreSQL credential was already imported into your encrypted connection cache (same store DB Studio uses) — saving here just links it to a project/environment label. Re-running discovery for the same app reuses the cached credential instead of re-detecting it.
          </p>
          {candidates.map((candidate) => (
            <CandidateRow
              key={candidate.cfTargetKey}
              candidate={candidate}
              onSave={async (input) => {
                await toolStudioApi.saveAuditLogEnvironment({
                  projectName: input.projectName,
                  envLabel: input.envLabel,
                  cfTargetKey: candidate.cfTargetKey,
                  region: candidate.region,
                  org: candidate.org,
                  space: candidate.space,
                  appName: candidate.appName ?? "",
                  connectionId: candidate.connectionId ?? "",
                });
                onSaved();
              }}
            />
          ))}
        </>
      )}

      <div className="row" style={{ marginTop: 16 }}>
        <Button variant="sec" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
