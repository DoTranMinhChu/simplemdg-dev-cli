import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { useAsync } from "../../../hooks/useAsync";
import { useJobEvents } from "../hooks/useJobEvents";
import type { TJobStep } from "../hooks/useJobEvents";
import { GitLabLoginModal } from "../components/GitLabLoginModal";
import { CreateDeployTargetForm } from "../components/CreateDeployTargetForm";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TDeployModelResult, TDeployTarget, TDiscoveredObjectType } from "../api/tool-studio-api-client";

function mergeSteps(prev: TJobStep[], incoming: TJobStep[]): TJobStep[] {
  const map = new Map(prev.map((step) => [step.key, step]));
  for (const step of incoming) map.set(step.key, step);
  return Array.from(map.values());
}

export function DeployModelPage(): React.ReactElement {
  const targets = useAsync(() => toolStudioApi.listDeployTargets());
  useEffect(() => {
    void targets.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [showCreateTarget, setShowCreateTarget] = useState(false);
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
  const preview = useAsync((uploadId: string) => toolStudioApi.previewEdmxImport(uploadId));

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
    if (event.type === "job-step" && event.steps) setJobSteps((prev) => mergeSteps(prev, event.steps!));
    if (event.type === "job-completed") setJobResult(event.result as TDeployModelResult);
    if (event.type === "job-failed") setJobError(event.error);
  });

  const canDeploy = Boolean(target && objectType && upload.data?.uploadId && !startJob.loading);

  return (
    <div>
      <div className="ts-header">
        <h1>Deploy Model</h1>
        <p className="note">
          Upload an SAP OData <code>$metadata</code> EDMX export, convert it with the real <code>cds import</code> CLI,
          and open a merge request into the object type's srv/srv_process repos — the same GitLab-branch-and-MR
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

      <div className="ts-card" style={{ maxWidth: 1000 }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <SearchableSelect
              value={target?.id ?? ""}
              onChange={(value) => setTarget(targets.data?.targets.find((item) => item.id === value))}
              placeholder="Select a deploy target..."
              searchPlaceholder="Search targets..."
              options={(targets.data?.targets ?? []).map((item) => ({ value: item.id, label: item.name, meta: item.gitlabGroupPath }))}
            />
          </div>
          <Button variant="sec" size="sm" onClick={() => setShowCreateTarget((value) => !value)}>
            {showCreateTarget ? "Cancel" : "+ New target"}
          </Button>
        </div>
      </div>

      {showCreateTarget && (
        <div style={{ marginTop: 12 }}>
          <CreateDeployTargetForm
            onCreated={(created) => {
              setShowCreateTarget(false);
              setTarget(created);
              void targets.run();
            }}
          />
        </div>
      )}

      {target && (
        <div className="ts-card" style={{ maxWidth: 1000, marginTop: 16 }}>
          <div className="note" style={{ marginBottom: 8 }}>Object types discovered in {target.gitlabGroupPath}:</div>
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
      )}

      {target && objectType && (
        <div className="ts-card" style={{ maxWidth: 1000, marginTop: 16 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xml,.edmx"
            style={{ display: "none" }}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              const result = await upload.run(file);
              if (result?.uploadId) void preview.run(result.uploadId);
            }}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={upload.loading}>
            {upload.loading ? <Spinner /> : "Upload EDMX metadata file"}
          </Button>
          {upload.error && <div className="errbox" style={{ marginTop: 8 }}>{upload.error}</div>}

          {preview.loading && <div className="note" style={{ marginTop: 8 }}><Spinner /> converting to CSN...</div>}
          {preview.error && <div className="errbox" style={{ marginTop: 8 }}>{preview.error}</div>}
          {preview.data?.entityName && (
            <div style={{ marginTop: 12 }}>
              <div className="note">Entity: {preview.data.entityName}</div>
              <pre className="cell-pre" style={{ maxHeight: 240, overflow: "auto" }}>{JSON.stringify(preview.data.csn, null, 2)}</pre>
            </div>
          )}
        </div>
      )}

      {target && objectType && upload.data?.uploadId && (
        <div className="ts-card" style={{ maxWidth: 1000, marginTop: 16 }}>
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

          {jobResult && (
            <div style={{ marginTop: 12 }}>
              {jobResult.mergeRequests.map((mr) => (
                <div className="ts-step-row success" key={mr.webUrl}>
                  <span className="ts-step-icon">✓</span>
                  <div>
                    <a href={mr.webUrl} target="_blank" rel="noreferrer">{mr.pathWithNamespace} — MR</a>
                  </div>
                </div>
              ))}
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
      )}
    </div>
  );
}
