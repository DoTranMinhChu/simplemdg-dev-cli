import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { Collapsible } from "../../../components/common/Collapsible";
import { useAsync } from "../../../hooks/useAsync";
import { useJobEvents, mergeJobSteps } from "../hooks/useJobEvents";
import type { TJobStep } from "../hooks/useJobEvents";
import { CreateDeployTargetForm } from "../components/CreateDeployTargetForm";
import { DeployTargetInfo } from "../components/DeployTargetInfo";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCdsUpgradeResult, TDeployTarget } from "../api/tool-studio-api-client";

const PREVIEW_BUCKET_LABEL: Record<string, string> = {
  wouldUpgrade: "Would upgrade",
  alreadyUpToDate: "Already up to date",
  branchNotFound: "Branch not found",
  unknownVersion: "Could not read @sap/cds version",
};

function StepHead({ n, title, sub, done }: { n: number; title: string; sub?: string; done?: boolean }): React.ReactElement {
  return (
    <div className="dm-step-head">
      <span className="dm-step-num">{done ? "✓" : n}</span>
      <span className="dm-step-title">{title}</span>
      {sub && <span className="dm-step-sub">{sub}</span>}
    </div>
  );
}

export function CdsBulkUpgradePage(): React.ReactElement {
  const targets = useAsync(() => toolStudioApi.listDeployTargets());
  useEffect(() => {
    void targets.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [target, setTarget] = useState<TDeployTarget | undefined>();
  const [targetForm, setTargetForm] = useState<"none" | "create" | "edit">("none");
  const candidateRepos = useAsync((deployTargetId: string) => toolStudioApi.getCdsUpgradeCandidateRepos(deployTargetId));

  useEffect(() => {
    if (target) void candidateRepos.run(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const [sourceBranch, setSourceBranch] = useState("");
  const [targetVersion, setTargetVersion] = useState("");
  const preview = useAsync(() => toolStudioApi.previewCdsUpgrade({ deployTargetId: target!.id, sourceBranch: sourceBranch.trim(), targetVersion: targetVersion.trim() }));

  const [jobId, setJobId] = useState<string | undefined>();
  const [jobSteps, setJobSteps] = useState<TJobStep[]>([]);
  const [jobResult, setJobResult] = useState<TCdsUpgradeResult | undefined>();
  const [jobError, setJobError] = useState<string | undefined>();
  const startJob = useAsync(() => toolStudioApi.startCdsUpgradeJob({ deployTargetId: target!.id, sourceBranch: sourceBranch.trim(), targetVersion: targetVersion.trim() }));

  useJobEvents(jobId, (event) => {
    if (event.type === "job-step" && event.steps) setJobSteps((prev) => mergeJobSteps(prev, event.steps!));
    if (event.type === "job-completed") setJobResult(event.result as TCdsUpgradeResult);
    if (event.type === "job-failed") setJobError(event.error);
  });

  const hasPreviewed = Boolean(preview.data?.rows);
  const canRun = Boolean(target && sourceBranch.trim() && targetVersion.trim() && hasPreviewed && !startJob.loading);

  return (
    <div>
      <div className="ts-header">
        <h1>Upgrade CDS Version</h1>
        <p className="note">
          Bulk-upgrade <code>@sap/cds</code>/<code>@sap/cds-dk</code>/<code>@sap/cds-compiler</code> on one branch across every
          db/srv/srv_process repo in a master-data GitLab group — validated with a real <code>npm install</code> +{" "}
          <code>cds compile</code> before anything is pushed. Opens a Merge Request per repo for review; never merges automatically.
        </p>
      </div>

      <div className={`dm-step${target ? " done" : ""}`}>
        <StepHead n={1} title="Deploy target" sub={target?.gitlabGroupPath} done={Boolean(target)} />
        <div className="ts-card">
          <div className="row">
            <div style={{ flex: 1 }}>
              <SearchableSelect
                value={target?.id ?? ""}
                onChange={(value) => setTarget(targets.data?.targets.find((item) => item.id === value))}
                placeholder="Select a deploy target..."
                searchPlaceholder="Search targets..."
                options={(targets.data?.targets ?? []).map((item) => ({ value: item.id, label: item.name, meta: item.gitlabGroupPath }))}
              />
            </div>
            {target && (
              <Button variant="sec" size="sm" onClick={() => setTargetForm((mode) => (mode === "edit" ? "none" : "edit"))}>
                {targetForm === "edit" ? "Cancel" : "Edit"}
              </Button>
            )}
            <Button variant="sec" size="sm" onClick={() => setTargetForm((mode) => (mode === "create" ? "none" : "create"))}>
              {targetForm === "create" ? "Cancel" : "+ New target"}
            </Button>
          </div>
          {target && <DeployTargetInfo target={target} />}
          {targetForm !== "none" && (
            <div style={{ marginTop: 12 }}>
              <CreateDeployTargetForm
                key={targetForm === "edit" ? target?.id : "create"}
                existingTarget={targetForm === "edit" ? target : undefined}
                onCreated={(saved) => {
                  setTargetForm("none");
                  setTarget(saved);
                  void targets.run();
                }}
              />
            </div>
          )}
          {target && (
            <div className="note" style={{ marginTop: 8 }}>
              {candidateRepos.loading ? (
                <><Spinner /> scanning repos...</>
              ) : candidateRepos.data?.error ? (
                candidateRepos.data.error
              ) : (
                `${candidateRepos.data?.repos.length ?? 0} repo(s) found in this group (db + srv + srv_process).`
              )}
            </div>
          )}
        </div>
      </div>

      {target && (
        <div className="dm-step">
          <StepHead n={2} title="Branch + target version" />
          <div className="ts-card">
            <div className="ts-grid-2">
              <div className="field">
                <label>Source branch (checked and upgraded across every repo)</label>
                <input className="input" value={sourceBranch} onChange={(event) => { setSourceBranch(event.target.value); preview.reset(); }} placeholder="e.g. uat" />
              </div>
              <div className="field">
                <label>Target @sap/cds version</label>
                <input className="input" value={targetVersion} onChange={(event) => { setTargetVersion(event.target.value); preview.reset(); }} placeholder="e.g. 9.7.2" />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <Button
                variant="sec"
                onClick={() => void preview.run()}
                disabled={!sourceBranch.trim() || !targetVersion.trim() || preview.loading}
              >
                {preview.loading ? <Spinner /> : "Preview"}
              </Button>
              <span className="note">Read-only — checks each repo's current version off the branch above. Nothing is cloned or written yet.</span>
            </div>

            {preview.error && <div className="errbox" style={{ marginTop: 12 }}>{preview.error}</div>}
            {preview.data?.error && <div className="errbox" style={{ marginTop: 12 }}>{preview.data.error}</div>}

            {preview.data?.rows && (
              <div className="ts-result" style={{ marginTop: 12 }}>
                {preview.data.rows.length === 0 ? (
                  <EmptyState>No repos found for this target.</EmptyState>
                ) : (
                  preview.data.rows.map((row) => (
                    <div className={`ts-step-row${row.bucket === "wouldUpgrade" ? "" : row.bucket === "alreadyUpToDate" ? " success" : " failed"}`} key={row.projectId}>
                      <span className="ts-step-icon">{row.bucket === "wouldUpgrade" ? "↑" : row.bucket === "alreadyUpToDate" ? "✓" : "✗"}</span>
                      <div>
                        <div>{row.pathWithNamespace} ({row.role})</div>
                        <div className="ts-step-detail">
                          {PREVIEW_BUCKET_LABEL[row.bucket]}
                          {row.currentVersion ? ` — currently @sap/cds@${row.currentVersion}` : ""}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {target && hasPreviewed && (
        <div className="dm-step">
          <StepHead n={3} title="Run upgrade" />
          <div className="ts-card">
            <div className="row">
              <Button
                disabled={!canRun}
                onClick={async () => {
                  setJobSteps([]);
                  setJobResult(undefined);
                  setJobError(undefined);
                  const result = await startJob.run();
                  if (result?.jobId) setJobId(result.jobId);
                  else if (result?.error) setJobError(result.error);
                }}
              >
                {startJob.loading ? <Spinner /> : "Run upgrade"}
              </Button>
              <span className="note">Only repos behind the target version are touched — clones, bumps, validates, and (only on success) opens an MR per repo.</span>
            </div>

            {startJob.error && <div className="errbox" style={{ marginTop: 12 }}>{startJob.error}</div>}
            {jobError && <div className="errbox" style={{ marginTop: 12 }}>{jobError}</div>}

            {jobSteps.length > 0 && (
              <div className="ts-result" style={{ marginTop: 12 }}>
                {jobSteps.map((step) => (
                  <div className={`ts-step-row ${step.status === "running" ? "" : step.status}`} key={step.key}>
                    <span className="ts-step-icon">{step.status === "running" ? <Spinner /> : step.status === "success" ? "✓" : step.status === "failed" ? "✗" : "–"}</span>
                    <div>
                      <div>{step.label}</div>
                      {step.detail && <div className="ts-step-detail">{step.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {jobResult && (
              <div style={{ marginTop: 12 }}>
                {jobResult.upgraded.length > 0 && (
                  <div className="ts-result">
                    <div className="dm-step-sub" style={{ marginBottom: 6 }}>Upgraded — Merge Request opened (not merged):</div>
                    {jobResult.upgraded.map((item) => (
                      <div className="ts-step-row success" key={item.projectId}>
                        <span className="ts-step-icon">✓</span>
                        <div>
                          <div>
                            {item.pathWithNamespace} — {item.mergeRequestUrl ? <a href={item.mergeRequestUrl} target="_blank" rel="noreferrer">open MR</a> : "MR link unavailable"}
                          </div>
                          {item.appliedFixups && item.appliedFixups.length > 0 && (
                            <div className="ts-step-detail">{item.appliedFixups.map((f) => f.title).join("; ")}</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {jobResult.buildFailed.length > 0 && (
                  <div className="ts-result" style={{ marginTop: 12 }}>
                    <div className="dm-step-sub" style={{ marginBottom: 6 }}>Build failed — nothing was committed, fix by hand:</div>
                    {jobResult.buildFailed.map((item) => (
                      <div className="ts-step-row failed" key={item.projectId}>
                        <span className="ts-step-icon">✗</span>
                        <div style={{ width: "100%" }}>
                          <div>{item.pathWithNamespace}</div>
                          {item.detail && (
                            <Collapsible summary="Show compiler/npm output">
                              <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: "var(--font-size-xs)", maxHeight: 240, overflowY: "auto" }}>{item.detail}</pre>
                            </Collapsible>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {(jobResult.alreadyUpToDate.length > 0 || jobResult.branchNotFound.length > 0 || jobResult.skipped.length > 0) && (
                  <div className="ts-result" style={{ marginTop: 12 }}>
                    {jobResult.alreadyUpToDate.map((item) => (
                      <div className="ts-step-row" key={item.projectId}>
                        <span className="ts-step-icon">–</span>
                        <div>{item.pathWithNamespace} — already at @sap/cds@{item.currentVersion}</div>
                      </div>
                    ))}
                    {jobResult.branchNotFound.map((item) => (
                      <div className="ts-step-row failed" key={item.projectId}>
                        <span className="ts-step-icon">✗</span>
                        <div>{item.pathWithNamespace} — branch "{sourceBranch}" not found</div>
                      </div>
                    ))}
                    {jobResult.skipped.map((item) => (
                      <div className="ts-step-row failed" key={item.projectId}>
                        <span className="ts-step-icon">✗</span>
                        <div>
                          <div>{item.pathWithNamespace}</div>
                          <div className="ts-step-detail">{item.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
