import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { Collapsible } from "../../../components/common/Collapsible";
import { JsonView } from "../../../components/common/JsonView";
import { useAsync } from "../../../hooks/useAsync";
import { useJobEvents, mergeJobSteps } from "../hooks/useJobEvents";
import type { TJobStep } from "../hooks/useJobEvents";
import { GitLabLoginModal } from "../components/GitLabLoginModal";
import { CreateDeployTargetForm } from "../components/CreateDeployTargetForm";
import { DeployChangesPreview } from "../components/DeployChangesPreview";
import { EntityRenameAlert } from "../components/EntityRenameAlert";
import { MergeRequestsPanel } from "../components/MergeRequestsPanel";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TDeployModelResult, TDeployTarget, TDiscoveredObjectType, TJoinFieldRisk } from "../api/tool-studio-api-client";

const JOIN_RISK_SEVERITY_LABEL: Record<TJoinFieldRisk["severity"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  info: "Info",
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

export function DeployModelPage(): React.ReactElement {
  const targets = useAsync(() => toolStudioApi.listDeployTargets());
  useEffect(() => {
    void targets.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [targetForm, setTargetForm] = useState<"none" | "create" | "edit">("none");
  const [showLogin, setShowLogin] = useState(false);
  const [target, setTarget] = useState<TDeployTarget | undefined>();

  const objectTypes = useAsync((targetId: string, refresh?: boolean) => toolStudioApi.getObjectTypesForTarget(targetId, refresh));
  const [objectType, setObjectType] = useState<TDiscoveredObjectType | undefined>();

  useEffect(() => {
    if (target) void objectTypes.run(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const upload = useAsync((file: File) => toolStudioApi.uploadEdmx(file));
  const preview = useAsync((uploadId: string) => toolStudioApi.previewEdmxImport(uploadId, objectType?.envObjectName, target?.objectTypeMode, objectType?.repos));
  const changesPreview = useAsync(() => toolStudioApi.previewDeployModelChanges({ uploadId: upload.data!.uploadId, deployTargetId: target!.id, objectTypeSlug: objectType!.slug }));

  const [ticketCode, setTicketCode] = useState("");
  const [jobId, setJobId] = useState<string | undefined>();
  const [jobSteps, setJobSteps] = useState<TJobStep[]>([]);
  const [jobResult, setJobResult] = useState<TDeployModelResult | undefined>();
  const [jobError, setJobError] = useState<string | undefined>();

  // The legacy tool resolves both assignee AND reviewer from a single "Assign User" picker — kept
  // as the default here, but with reviewer split into its own (optional) field since nothing about
  // GitLab's API requires them to be the same person, and letting them differ is a strict
  // improvement over the legacy behavior rather than a bug replication.
  const members = useAsync((projectId: number) => toolStudioApi.searchGitlabMembers(projectId, ""));
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [reviewerId, setReviewerId] = useState<string>("");

  useEffect(() => {
    if (objectType?.repos[0]) void members.run(objectType.repos[0].projectId);
    setAssigneeId("");
    setReviewerId("");
    changesPreview.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType]);

  const startJob = useAsync(() =>
    toolStudioApi.startDeployModelJob({
      uploadId: upload.data!.uploadId,
      deployTargetId: target!.id,
      objectTypeSlug: objectType!.slug,
      ticketCode: ticketCode || undefined,
      assigneeId: assigneeId ? Number(assigneeId) : undefined,
      reviewerIds: reviewerId ? [Number(reviewerId)] : assigneeId ? [Number(assigneeId)] : undefined,
    }),
  );

  useJobEvents(jobId, (event) => {
    if (event.type === "job-step" && event.steps) setJobSteps((prev) => mergeJobSteps(prev, event.steps!));
    if (event.type === "job-completed") setJobResult(event.result as TDeployModelResult);
    if (event.type === "job-failed") setJobError(event.error);
  });

  const canDeploy = Boolean(target && objectType && upload.data?.uploadId && !startJob.loading);
  const sortedRisks = [...(preview.data?.joinRisks ?? [])].sort((a, b) => {
    const order: Record<string, number> = { critical: 0, high: 1, medium: 2, info: 3 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <div>
      <div className="ts-header">
        <h1>Deploy Model</h1>
        <p className="note">
          Upload an SAP OData <code>$metadata</code> EDMX export, convert it with the real <code>cds import</code> CLI,
          and open a merge request into the object type's db/srv/srv_process repos — the same GitLab-branch-and-MR
          workflow the legacy tool used, but with live-discovered repos/branches instead of hardcoded environment codes.
        </p>
      </div>

      {showLogin && (
        <GitLabLoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            if (target) void objectTypes.run(target.id, true);
          }}
        />
      )}

      <div className={`dm-step${target ? " done" : ""}`}>
        <StepHead n={1} title="Deploy target" sub={target?.gitlabGroupPath} done={Boolean(target)} />
        <div className="ts-card" style={{ maxWidth: 900 }}>
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
        </div>
      </div>

      {target && (
        <div className={`dm-step${objectType ? " done" : ""}`}>
          <StepHead n={2} title="Object type" sub={objectType ? `${objectType.envObjectName} (${objectType.slug})` : undefined} done={Boolean(objectType)} />
          <div className="ts-card" style={{ maxWidth: 900 }}>
            {objectTypes.loading ? (
              <EmptyState><Spinner /> scanning repos for _laidonBuild.yaml...</EmptyState>
            ) : objectTypes.error || objectTypes.data?.error ? (
              <div className="errbox">
                {objectTypes.error || objectTypes.data?.error}
                <div className="row" style={{ marginTop: 8 }}>
                  <Button size="sm" onClick={() => setShowLogin(true)}>Login to GitLab</Button>
                </div>
              </div>
            ) : !objectTypes.data?.objectTypes.length ? (
              <EmptyState>No object types discovered yet.</EmptyState>
            ) : (
              <SearchableSelect
                value={objectType?.slug ?? ""}
                onChange={(value) => setObjectType(objectTypes.data?.objectTypes.find((item) => item.slug === value))}
                placeholder="Select an object type..."
                searchPlaceholder="Search object types..."
                options={objectTypes.data.objectTypes.map((item) => ({ value: item.slug, label: `${item.envObjectName} (${item.slug})`, meta: `${item.repos.length} repo(s)` }))}
              />
            )}
          </div>
        </div>
      )}

      {target && objectType && (
        <div className={`dm-step${preview.data?.entityName ? " done" : ""}`}>
          <StepHead n={3} title="Upload EDMX" sub={preview.data?.entityName} done={Boolean(preview.data?.entityName)} />
          <div className="ts-card" style={{ maxWidth: 900 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml,.edmx"
              style={{ display: "none" }}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                changesPreview.reset();
                const result = await upload.run(file);
                if (result?.uploadId) void preview.run(result.uploadId);
              }}
            />
            <Button onClick={() => fileInputRef.current?.click()} disabled={upload.loading}>
              {upload.loading ? <Spinner /> : upload.data?.fileName ? `Re-upload (currently: ${upload.data.fileName})` : "Upload EDMX metadata file"}
            </Button>
            {upload.error && <div className="errbox" style={{ marginTop: 8 }}>{upload.error}</div>}

            {preview.loading && <div className="note" style={{ marginTop: 8 }}><Spinner /> converting to CSN...</div>}
            {preview.error && <div className="errbox" style={{ marginTop: 8 }}>{preview.error}</div>}
            {preview.data?.joinRiskError && (
              <div className="errbox" style={{ marginTop: 8 }}>
                Could not scan for join risks (this same error will block Deploy too): {preview.data.joinRiskError}
              </div>
            )}
            {preview.data?.renamedEntities && preview.data.renamedEntities.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <EntityRenameAlert renames={preview.data.renamedEntities} />
              </div>
            )}
            {sortedRisks.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="note" style={{ marginBottom: 8 }}>
                  {sortedRisks.length} composition join warning(s) — these relations have no <code>&lt;ReferentialConstraint&gt;</code> in the
                  source EDMX, so the join is reconstructed by matching field names, which can drop or mismatch a key.
                </div>
                <div className="dm-risk-list">
                  {sortedRisks.map((risk, index) => (
                    <div key={index} className={`dm-risk ${risk.severity}`}>
                      <span className="dm-risk-badge">{JOIN_RISK_SEVERITY_LABEL[risk.severity]}</span>
                      <div className="dm-risk-body">
                        <div className="dm-risk-title">
                          {risk.parentBusinessTable}.{risk.relationName} → {risk.targetBusinessTable}.{risk.parentKeyField}
                        </div>
                        <div className="dm-risk-message">{risk.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {preview.data?.entityName && (
              <div style={{ marginTop: 12 }}>
                <div className="note" style={{ marginBottom: 6 }}>
                  Entity: {preview.data.entityName}
                  {preview.data.cdsDkVersion && ` · imported with @sap/cds-dk@${preview.data.cdsDkVersion} (pinned, not this machine's global install)`}
                </div>
                <Collapsible summary="Parsed CSN (JSON) — click to view">
                  <JsonView value={preview.data.csn} />
                </Collapsible>
              </div>
            )}
          </div>
        </div>
      )}

      {target && objectType && upload.data?.uploadId && (
        <div className="dm-step">
          <StepHead n={4} title="Review changes" sub="what would actually be committed, before you deploy" />
          <div className="ts-card" style={{ maxWidth: 900 }}>
            <div className="row">
              <Button variant="sec" onClick={() => void changesPreview.run()} disabled={changesPreview.loading}>
                {changesPreview.loading ? <Spinner /> : "Preview file changes"}
              </Button>
              <span className="note">See exactly what would change in db/srv/srv_process — no GitLab needed to check.</span>
            </div>
            {changesPreview.error && <div className="errbox" style={{ marginTop: 12 }}>{changesPreview.error}</div>}
            {changesPreview.data?.error && <div className="errbox" style={{ marginTop: 12 }}>{changesPreview.data.error}</div>}
            {changesPreview.data?.renamedEntities && changesPreview.data.renamedEntities.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <EntityRenameAlert renames={changesPreview.data.renamedEntities} />
              </div>
            )}
            {changesPreview.data && !changesPreview.data.error && (
              <div style={{ marginTop: 12 }}>
                <DeployChangesPreview result={changesPreview.data} />
              </div>
            )}
          </div>
        </div>
      )}

      {target && objectType && upload.data?.uploadId && (
        <div className="dm-step">
          <StepHead n={5} title="Deploy" />
          <div className="ts-card" style={{ maxWidth: 900 }}>
            <div className="ts-grid-2">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Ticket code (optional — used verbatim as the MR title; left blank, a title is generated from the repo/branch/date)</label>
                <input className="input" value={ticketCode} onChange={(event) => setTicketCode(event.target.value)} placeholder={target.ticketCodes[0] ?? "e.g. PROJ-1234"} />
              </div>
              <div className="field">
                <label>Assignee (optional)</label>
                <SearchableSelect
                  value={assigneeId}
                  onChange={setAssigneeId}
                  disabled={members.loading}
                  placeholder={members.loading ? "Loading members..." : "Unassigned"}
                  searchPlaceholder="Search members..."
                  options={(members.data?.members ?? []).map((user) => ({ value: String(user.id), label: user.name, meta: `@${user.username}` }))}
                />
              </div>
              <div className="field">
                <label>Reviewer (optional, defaults to assignee)</label>
                <SearchableSelect
                  value={reviewerId}
                  onChange={setReviewerId}
                  disabled={members.loading}
                  placeholder={members.loading ? "Loading members..." : "Same as assignee"}
                  searchPlaceholder="Search members..."
                  options={(members.data?.members ?? []).map((user) => ({ value: String(user.id), label: user.name, meta: `@${user.username}` }))}
                />
              </div>
            </div>
            {members.error && <div className="errbox" style={{ marginTop: 8 }}>{members.error}</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <Button
                disabled={!canDeploy}
                onClick={async () => {
                  setJobSteps([]);
                  setJobResult(undefined);
                  setJobError(undefined);
                  const result = await startJob.run();
                  if (result?.jobId) setJobId(result.jobId);
                  else if (result?.error) setJobError(result.error);
                }}
              >
                {startJob.loading ? <Spinner /> : "Deploy"}
              </Button>
            </div>

            {startJob.error && <div className="errbox" style={{ marginTop: 12 }}>{startJob.error}</div>}
            {jobError && <div className="errbox" style={{ marginTop: 12 }}>{jobError}</div>}

            {jobSteps.length > 0 && (
              <div className="ts-result">
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

            {jobResult && jobResult.renamedEntities.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <EntityRenameAlert renames={jobResult.renamedEntities} />
              </div>
            )}
            {jobResult && jobResult.mergeRequests.length > 0 && <MergeRequestsPanel mergeRequests={jobResult.mergeRequests} />}
            {jobResult && (
              <div style={{ marginTop: 12 }}>
                {jobResult.noChange.map((item) => (
                  <div className="ts-step-row" key={item.pathWithNamespace}>
                    <span className="ts-step-icon">–</span>
                    <div>
                      <div>{item.pathWithNamespace} — no changes, nothing to merge</div>
                      <div className="ts-step-detail">{item.sourceBranch} vs {item.targetBranch} (branch removed)</div>
                    </div>
                  </div>
                ))}
                {jobResult.skipped.map((item) => (
                  <div className="ts-step-row failed" key={item.pathWithNamespace}>
                    <span className="ts-step-icon">✗</span>
                    <div>
                      <div>{item.pathWithNamespace}</div>
                      <div className="ts-step-detail">{item.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
