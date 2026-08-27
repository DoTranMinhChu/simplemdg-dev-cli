import type { TDeployTarget } from "../api/tool-studio-api-client";

/**
 * Compact summary row for the currently-selected `TDeployTarget` — group, default branch, CDS
 * version, object-type mode, consolidation — shown right under the target picker on every page that
 * starts with a "Deploy target" step (Deploy Model, Move Model, Upgrade CDS Version). Without this,
 * picking the wrong target (or forgetting which branch/CDS version it's pinned to) only surfaced
 * later, e.g. after a Preview. Values are shown verbatim (raw `objectTypeMode`/`cdsVersionDefault`
 * strings, e.g. `eventmesh`/`cds8`) — same convention `CreateDeployTargetForm` already uses, not a
 * prettified label map.
 */
export function DeployTargetInfo({ target }: { target: TDeployTarget }): React.ReactElement {
  return (
    <div className="dt-info-row">
      <span className="dt-info-chip">
        <span className="dt-info-label">Group</span> {target.gitlabGroupPath}
      </span>
      <span className="dt-info-chip">
        <span className="dt-info-label">Default branch</span> {target.defaultBranch}
      </span>
      <span className="dt-info-chip">
        <span className="dt-info-label">CDS</span> {target.cdsVersionDefault}
      </span>
      <span className="dt-info-chip">
        <span className="dt-info-label">Mode</span> {target.objectTypeMode}
      </span>
      {target.isConsolidationDefault && (
        <span className="dt-info-chip">
          <span className="dt-info-label">Consolidation</span> on
        </span>
      )}
    </div>
  );
}
