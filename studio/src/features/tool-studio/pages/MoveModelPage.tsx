import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { Collapsible } from "../../../components/common/Collapsible";
import { useAsync } from "../../../hooks/useAsync";
import { GitLabLoginModal } from "../components/GitLabLoginModal";
import { CreateDeployTargetForm } from "../components/CreateDeployTargetForm";
import { DeployTargetInfo } from "../components/DeployTargetInfo";
import { EntityFieldChangesReport } from "../components/EntityFieldChangesReport";
import { DeployChangesPreview } from "../components/DeployChangesPreview";
import { MergeRequestsPanel } from "../components/MergeRequestsPanel";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TDeployTarget, TDiscoveredObjectType, TObjectTypeRepoRef } from "../api/tool-studio-api-client";

function StepHead({ n, title, sub, done }: { n: number; title: string; sub?: string; done?: boolean }): React.ReactElement {
  return (
    <div className="dm-step-head">
      <span className="dm-step-num">{done ? "✓" : n}</span>
      <span className="dm-step-title">{title}</span>
      {sub && <span className="dm-step-sub">{sub}</span>}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { db: "db", srv: "srv", srv_process: "srv_process", unknown: "unknown" };

/** Which repo to read the branch list from — `db` is the anchor role every object type has (Move Model's own repo-picker still lets the user deselect it), falling back to whatever's first when an object type has no `db` repo (e.g. a manually-added srv-only entry). */
function pickAnchorRepo(repos: TObjectTypeRepoRef[]): TObjectTypeRepoRef | undefined {
  return repos.find((repo) => repo.role === "db") ?? repos[0];
}

export function MoveModelPage(): React.ReactElement {
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

  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const branches = useAsync((projectId: number) => toolStudioApi.listGitlabBranches(projectId));
  const [sourceBranch, setSourceBranch] = useState("");
  const [targetBranch, setTargetBranch] = useState("");
  const preview = useAsync(() =>
    toolStudioApi.previewMoveModelChanges({
      deployTargetId: target!.id,
      objectTypeSlug: objectType!.slug,
      repoRoles: Array.from(selectedRoles),
      sourceBranch: sourceBranch.trim(),
      targetBranch: targetBranch.trim(),
    }),
  );

  useEffect(() => {
    if (!objectType) return;
    setSelectedRoles(new Set(objectType.repos.map((repo) => repo.role)));
    setSourceBranch("");
    // Pre-filled from the deploy target already picked in step 1 (same "Default branch" shown in
    // its info chips) — that's the one branch this target is actually deployed/promoted onto, so
    // re-picking it by hand in step 3 would just be re-selecting the same thing. Still a real
    // `SearchableSelect`, not locked — a real use case (e.g. landing on a hotfix branch instead)
    // just overrides it like any other field.
    setTargetBranch(target?.defaultBranch ?? "");
    preview.reset();
    createMr.reset();
    const anchor = pickAnchorRepo(objectType.repos);
    if (anchor) void branches.run(anchor.projectId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType]);

  const members = useAsync((projectId: number) => toolStudioApi.searchGitlabMembers(projectId, ""));
  const [assigneeId, setAssigneeId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (objectType?.repos[0]) void members.run(objectType.repos[0].projectId);
    setAssigneeId("");
    setReviewerId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectType]);

  const createMr = useAsync(() =>
    toolStudioApi.createMoveModelMergeRequests({
      deployTargetId: target!.id,
      objectTypeSlug: objectType!.slug,
      repoRoles: Array.from(selectedRoles),
      sourceBranch: sourceBranch.trim(),
      targetBranch: targetBranch.trim(),
      title: title.trim() || undefined,
      description: description.trim() || undefined,
      assigneeId: assigneeId ? Number(assigneeId) : undefined,
      reviewerIds: reviewerId ? [Number(reviewerId)] : assigneeId ? [Number(assigneeId)] : undefined,
    }),
  );

  const branchesReady = Boolean(sourceBranch.trim() && targetBranch.trim() && sourceBranch.trim() !== targetBranch.trim());
  const canPreview = Boolean(target && objectType && selectedRoles.size > 0 && branchesReady && !preview.loading);
  const hasPreviewed = Boolean(preview.data && !preview.data.error);
  const canCreateMr = Boolean(hasPreviewed && !createMr.loading);

  return (
    <div>
      <div className="ts-header">
        <h1>Move Model</h1>
        <p className="note">
          Promote a model that already exists on one branch (e.g. a shared <code>DEV</code> working branch) into another branch
          (e.g. <code>main</code>) of the same object type's db/srv/srv_process repos — no upload, no regenerated content. See exactly
          which entities/fields would change on the target branch, then open the Merge Request(s) directly.
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
        </div>
      </div>

      {target && (
        <div className={`dm-step${objectType ? " done" : ""}`}>
          <StepHead n={2} title="Object type" sub={objectType ? `${objectType.envObjectName} (${objectType.slug})` : undefined} done={Boolean(objectType)} />
          <div className="ts-card">
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
        <div className={`dm-step${branchesReady ? " done" : ""}`}>
          <StepHead n={3} title="Repos + branches" sub={branchesReady ? `${sourceBranch} → ${targetBranch}` : undefined} done={branchesReady} />
          <div className="ts-card">
            {objectType.repos.length > 1 && (
              <div style={{ marginBottom: 12 }}>
                {/* Every repo is already included by default (see the `[objectType]` effect) — this only
                    ever needs opening to NARROW the scope (e.g. move just `db`, skip `srv`), so it stays
                    collapsed instead of presenting as a mandatory re-selection of what object type already
                    determined. */}
                <Collapsible
                  summary={`${selectedRoles.size} of ${objectType.repos.length} repos included (${objectType.repos
                    .filter((repo) => selectedRoles.has(repo.role))
                    .map((repo) => ROLE_LABEL[repo.role] ?? repo.role)
                    .join(", ")}) — click to narrow down`}
                >
                  <div className="row" style={{ gap: 16, marginTop: 8 }}>
                    {objectType.repos.map((repo) => (
                      <label key={repo.pathWithNamespace} className="row" style={{ gap: 6, alignItems: "center", fontWeight: "normal" }}>
                        <input
                          type="checkbox"
                          checked={selectedRoles.has(repo.role)}
                          onChange={(event) => {
                            setSelectedRoles((prev) => {
                              const next = new Set(prev);
                              if (event.target.checked) next.add(repo.role);
                              else next.delete(repo.role);
                              return next;
                            });
                            preview.reset();
                          }}
                        />
                        {ROLE_LABEL[repo.role] ?? repo.role} <span className="note">({repo.pathWithNamespace})</span>
                      </label>
                    ))}
                  </div>
                </Collapsible>
              </div>
            )}

            <div className="ts-grid-2">
              <div className="field">
                <label>Source branch (A) — where the model already lives</label>
                <SearchableSelect
                  value={sourceBranch}
                  onChange={(value) => { setSourceBranch(value); preview.reset(); }}
                  disabled={branches.loading}
                  placeholder={branches.loading ? "Loading branches..." : "Select source branch..."}
                  searchPlaceholder="Search branches..."
                  options={(branches.data?.branches ?? []).map((branch) => ({ value: branch.name, label: branch.name, meta: branch.protected ? "protected" : undefined }))}
                />
              </div>
              <div className="field">
                <label>Target branch (B) — where it should land (defaults to this target's branch, change if needed)</label>
                <SearchableSelect
                  value={targetBranch}
                  onChange={(value) => { setTargetBranch(value); preview.reset(); }}
                  disabled={branches.loading}
                  placeholder={branches.loading ? "Loading branches..." : "Select target branch..."}
                  searchPlaceholder="Search branches..."
                  options={(branches.data?.branches ?? []).map((branch) => ({ value: branch.name, label: branch.name, meta: branch.protected ? "protected" : undefined }))}
                />
              </div>
            </div>
            <div className="note" style={{ marginTop: 8 }}>
              Branch names are read from {pickAnchorRepo(objectType.repos)?.pathWithNamespace ?? "the object type's anchor repo"} and applied to every
              selected repo above — if a repo doesn't have a branch with this exact name, it shows up under "Skipped" with GitLab's own error instead
              of silently doing nothing.
            </div>
            {branches.error && <div className="errbox" style={{ marginTop: 8 }}>{branches.error}</div>}
            {branches.data?.error && <div className="errbox" style={{ marginTop: 8 }}>{branches.data.error}</div>}
          </div>
        </div>
      )}

      {target && objectType && branchesReady && (
        <div className="dm-step">
          <StepHead n={4} title="Preview changes" sub="field-level report, before you open any Merge Request" />
          <div className="ts-card">
            <div className="row">
              <Button variant="sec" onClick={() => void preview.run()} disabled={!canPreview}>
                {preview.loading ? <Spinner /> : "Preview changes"}
              </Button>
              <span className="note">Read-only — reads both branches, opens nothing on GitLab.</span>
            </div>

            {preview.error && <div className="errbox" style={{ marginTop: 12 }}>{preview.error}</div>}
            {preview.data?.error && <div className="errbox" style={{ marginTop: 12 }}>{preview.data.error}</div>}

            {hasPreviewed && preview.data && (
              <div style={{ marginTop: 12 }}>
                <EntityFieldChangesReport repos={preview.data.repos} />
                <div style={{ marginTop: 12 }}>
                  <DeployChangesPreview
                    result={{ entityName: `${preview.data.sourceBranch} → ${preview.data.targetBranch}`, repos: preview.data.repos, renamedEntities: [], customModelWarnings: [] }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {target && objectType && hasPreviewed && (
        <div className="dm-step">
          <StepHead n={5} title="Create Merge Request" />
          <div className="ts-card">
            <div className="ts-grid-2">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Title (optional — a title is generated from the repo/branches if left blank)</label>
                <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Move model: ${sourceBranch} → ${targetBranch}`} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>Description (optional)</label>
                <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Left blank, a default description is used" />
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
                disabled={!canCreateMr}
                onClick={() => {
                  createMr.reset();
                  void createMr.run();
                }}
              >
                {createMr.loading ? <Spinner /> : "Create Merge Request"}
              </Button>
            </div>

            {createMr.error && <div className="errbox" style={{ marginTop: 12 }}>{createMr.error}</div>}
            {createMr.data?.error && <div className="errbox" style={{ marginTop: 12 }}>{createMr.data.error}</div>}

            {createMr.data && createMr.data.mergeRequests.length > 0 && <MergeRequestsPanel mergeRequests={createMr.data.mergeRequests} />}

            {createMr.data && (createMr.data.noChange.length > 0 || createMr.data.skipped.length > 0) && (
              <div style={{ marginTop: 12 }}>
                {createMr.data.noChange.map((item) => (
                  <div className="ts-step-row" key={item.pathWithNamespace}>
                    <span className="ts-step-icon">–</span>
                    <div>
                      <div>{item.pathWithNamespace} — no changes, nothing to merge</div>
                      <div className="ts-step-detail">{item.sourceBranch} vs {item.targetBranch}</div>
                    </div>
                  </div>
                ))}
                {createMr.data.skipped.map((item) => (
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
