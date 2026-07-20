import type { TCustomModelWarning } from "../api/tool-studio-api-client";

/** Reuses `EntityRenameAlert`'s styling — a `custom-model.cds` attachment (see `custom-model-preserver.ts`) existed on the previously-committed file but couldn't be carried forward into this regenerate, same real "your customization may be lost" severity as an entity rename. */
export function CustomModelWarningAlert({ warnings }: { warnings: TCustomModelWarning[] }): React.ReactElement | null {
  if (!warnings.length) return null;
  return (
    <div className="dm-rename-alert">
      <div className="dm-rename-alert-title">
        ⚠ {warnings.length} custom-model.cds attachment{warnings.length === 1 ? "" : "s"} could not be carried forward
      </div>
      <div className="dm-rename-alert-body">
        A <code>custom-model.cds</code> entity was previously wired into one of these entities, but this upload no longer
        contains it, so the attachment could not be re-applied. Verify manually before merging — the custom entity itself
        is untouched, only its link to the regenerated model may need re-adding.
      </div>
      <ul className="dm-rename-alert-list">
        {warnings.map((w) => (
          <li key={w.businessTable}>{w.message}</li>
        ))}
      </ul>
    </div>
  );
}
