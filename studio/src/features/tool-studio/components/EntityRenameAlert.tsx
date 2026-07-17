import type { TEntityRenameRisk } from "../api/tool-studio-api-client";

/** Prominent, deliberately alarming banner for `TEntityRenameRisk` — real data-loss risk (see the type's own doc comment), not just a join/structure warning, so it's styled and worded to stand out from `dm-risk`. */
export function EntityRenameAlert({ renames }: { renames: TEntityRenameRisk[] }): React.ReactElement | null {
  if (!renames.length) return null;
  return (
    <div className="dm-rename-alert">
      <div className="dm-rename-alert-title">
        ⚠ {renames.length} entity label change{renames.length === 1 ? "" : "s"} detected — possible data loss risk
      </div>
      <div className="dm-rename-alert-body">
        The field structure is identical, but the SAP-side display label changed. This tool names each table after its label, so deploying this will make it generate a <strong>different, empty table</strong> instead of updating the existing one — the old table (with real data) can be dropped or orphaned by
        the next HANA deployment. Do not deploy until you've confirmed this is intentional and coordinated a manual database migration.
      </div>
      <ul className="dm-rename-alert-list">
        {renames.map((r) => (
          <li key={r.technicalName}>
            <code>{r.technicalName}</code>: "{r.oldLabel}" → "{r.newLabel}"
          </li>
        ))}
      </ul>
    </div>
  );
}
