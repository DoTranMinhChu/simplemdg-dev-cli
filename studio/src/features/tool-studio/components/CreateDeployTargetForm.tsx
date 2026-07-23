import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { BtpTargetSelector } from "../../../components/btp/BtpTargetSelector";
import { useAsync } from "../../../hooks/useAsync";
import { GitLabLoginModal } from "./GitLabLoginModal";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TDeployTarget, TGitLabGroup, TObjectTypeMode, TCdsVersion } from "../api/tool-studio-api-client";
import type { TCfTargetSummary } from "../../../api/studio-api-types";

const OBJECT_TYPE_MODES: TObjectTypeMode[] = ["eventmesh", "eventmesh_v1.6+", "multiple_erp", "multiple_erp_central", "buma", "SAP_SF", "natrol_ecc", "custom"];
const CDS_VERSIONS: TCdsVersion[] = ["cds6", "cds7", "cds8"];

/**
 * Shared "create OR edit a deploy target" form — used by both Deploy Model and Check API External
 * so a new environment can be added from wherever the user happens to be, not just one page. Pass
 * `existingTarget` to edit it in place (pre-fills every field from it, and the save call includes
 * its `id` so `upsertDeployTarget` updates the existing record instead of creating a new one).
 *
 * `defaultBranch` is always taken verbatim from `existingTarget`/the free-text input — this field is
 * the deploy target's own configured "branch to work from" (e.g. `staging`), which is deliberately
 * independent of whatever GitLab reports as the repo's actual git default branch (that distinction
 * is exactly why `object-type-discovery.ts` treats a deploy target's configured branch as
 * authoritative and only falls back to GitLab's real default for repos that don't have content on
 * it — see `resolveBuildYamlContent`). This form must never "helpfully" overwrite it from GitLab.
 */
export function CreateDeployTargetForm({ existingTarget, onCreated }: { existingTarget?: TDeployTarget; onCreated: (target: TDeployTarget) => void }): React.ReactElement {
  // Always bypass the group-list cache here: this form is opened rarely and deliberately, so a
  // live, authoritative GitLab response (surfacing a real "not logged in"/"token revoked" error)
  // matters more than instant load — a cached empty list would otherwise render silently as if
  // the account genuinely had zero groups.
  const groups = useAsync(() => toolStudioApi.getGitlabGroups(true));
  useEffect(() => {
    void groups.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showLogin, setShowLogin] = useState(false);

  const [name, setName] = useState(existingTarget?.name ?? "");
  // Reconstructed straight from the saved target — not re-fetched/re-suggested from GitLab, so
  // editing a target never depends on the groups list having loaded yet.
  const [group, setGroup] = useState<TGitLabGroup | undefined>(
    existingTarget ? { id: existingTarget.gitlabGroupId, full_path: existingTarget.gitlabGroupPath, name: existingTarget.gitlabGroupPath.split("/").pop() ?? existingTarget.gitlabGroupPath } : undefined,
  );
  const [defaultBranch, setDefaultBranch] = useState(existingTarget?.defaultBranch ?? "main");
  const [objectTypeMode, setObjectTypeMode] = useState<TObjectTypeMode>(existingTarget?.objectTypeMode ?? "custom");
  const [cdsVersionDefault, setCdsVersionDefault] = useState<TCdsVersion>(existingTarget?.cdsVersionDefault ?? "cds8");
  const [isConsolidationDefault, setIsConsolidationDefault] = useState(existingTarget?.isConsolidationDefault ?? false);
  // A saved target only stores the CF target's `key`, not the full org/space/region breakdown, so
  // there's nothing to reconstruct into a `TCfTargetSummary` without an extra lookup — kept as its
  // own string, distinct from `cfTarget` (only set once the user actively picks a NEW one below).
  const [existingCfTargetKey, setExistingCfTargetKey] = useState(existingTarget?.cfTargetKey);
  const [cfTarget, setCfTarget] = useState<TCfTargetSummary | undefined>();
  const [showCfPicker, setShowCfPicker] = useState(false);

  const save = useAsync(() =>
    toolStudioApi.saveDeployTarget({
      id: existingTarget?.id,
      name,
      gitlabBaseUrl: groups.data?.gitlabBaseUrl ?? existingTarget?.gitlabBaseUrl ?? "",
      gitlabGroupId: group!.id,
      gitlabGroupPath: group!.full_path,
      defaultBranch,
      cfTargetKey: cfTarget?.key ?? existingCfTargetKey,
      objectTypeMode,
      cdsVersionDefault,
      isConsolidationDefault,
    }),
  );

  return (
    <div className="ts-card">
      {showLogin && (
        <GitLabLoginModal
          onClose={() => setShowLogin(false)}
          onSuccess={() => {
            setShowLogin(false);
            void groups.run();
          }}
        />
      )}
      <div className="ts-grid-2">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>Name</label>
          <input className="input" placeholder="e.g. S4 UAT" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>GitLab group</label>
          {groups.loading ? (
            <Spinner />
          ) : groups.error || groups.data?.error ? (
            <div className="errbox">
              {groups.error || groups.data?.error}
              <div className="row" style={{ marginTop: 8 }}>
                <Button size="sm" onClick={() => setShowLogin(true)}>Login to GitLab</Button>
              </div>
            </div>
          ) : (
            <SearchableSelect
              value={group ? String(group.id) : ""}
              onChange={(value) => setGroup(groups.data?.groups.find((item) => String(item.id) === value))}
              placeholder="Select a group..."
              searchPlaceholder="Search groups..."
              options={(groups.data?.groups ?? []).map((item) => ({ value: String(item.id), label: item.full_path }))}
            />
          )}
        </div>
        <div className="field">
          <label>Default branch</label>
          <input className="input" value={defaultBranch} onChange={(event) => setDefaultBranch(event.target.value)} />
        </div>
        <div className="field">
          <label>Object type mode</label>
          <SearchableSelect
            value={objectTypeMode}
            onChange={(value) => setObjectTypeMode(value as TObjectTypeMode)}
            options={OBJECT_TYPE_MODES.map((mode) => ({ value: mode, label: mode }))}
          />
        </div>
        <div className="field">
          <label>Default cdsVersion</label>
          <SearchableSelect
            value={cdsVersionDefault}
            onChange={(value) => setCdsVersionDefault(value as TCdsVersion)}
            options={CDS_VERSIONS.map((version) => ({ value: version, label: version }))}
          />
        </div>
        <div className="field">
          <label>
            <input type="checkbox" checked={isConsolidationDefault} onChange={(event) => setIsConsolidationDefault(event.target.checked)} style={{ marginRight: 6 }} />
            Consolidation by default
          </label>
        </div>
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>CF target (optional — needed for Check API External's live service discovery)</label>
          {cfTarget ? (
            <div className="row">
              <div className="note" style={{ flex: 1 }}>{cfTarget.org} / {cfTarget.space} ({cfTarget.region})</div>
              <Button variant="ghost" size="sm" onClick={() => setShowCfPicker(true)}>Change</Button>
              <Button variant="ghost" size="sm" onClick={() => setCfTarget(undefined)}>Clear</Button>
            </div>
          ) : existingCfTargetKey ? (
            <div className="row">
              <div className="note" style={{ flex: 1 }}>{existingCfTargetKey}</div>
              <Button variant="ghost" size="sm" onClick={() => setShowCfPicker(true)}>Change</Button>
              <Button variant="ghost" size="sm" onClick={() => setExistingCfTargetKey(undefined)}>Clear</Button>
            </div>
          ) : showCfPicker ? (
            <div className="ts-card" style={{ marginTop: 8 }}>
              <BtpTargetSelector onSelect={(selected) => { setCfTarget(selected); setShowCfPicker(false); }} />
            </div>
          ) : (
            <Button variant="sec" size="sm" onClick={() => setShowCfPicker(true)}>Link a CF org/space...</Button>
          )}
        </div>
      </div>
      <div className="row">
        <Button
          disabled={!name || !group || save.loading}
          onClick={async () => {
            const result = await save.run();
            if (result?.target) onCreated(result.target);
          }}
        >
          {save.loading ? <Spinner /> : existingTarget ? "Save changes" : "Create deploy target"}
        </Button>
      </div>
      {save.error && <div className="errbox" style={{ marginTop: 8 }}>{save.error}</div>}
    </div>
  );
}
