import { useState } from "react";
import type { TCdsEntityChange, TCdsFieldChange } from "../api/tool-studio-api-client";

/**
 * Shared by both preview producers: Move Model's (`TMoveModelRepoPreview`, always populates
 * `entityChanges`) and Deploy Model's (`TDeployRepoPreview`, ditto — but its sibling Custom Model
 * preview reuses the same response shape without computing it, hence optional here too). Declared
 * structurally instead of importing either specific type so this component works with whichever
 * preview result a page passes in.
 */
type TEntityChangesRepo = { role: string; pathWithNamespace: string; entityChanges?: TCdsEntityChange[] };

const ENTITY_KIND_LABEL: Record<TCdsEntityChange["kind"], string> = { added: "Entity added", removed: "Entity removed", changed: "Fields changed" };
const FIELD_KIND_LABEL: Record<TCdsFieldChange["kind"], string> = { added: "Added", removed: "Removed", changed: "Changed" };

function typeLabel(type: string | undefined, isKey: boolean | undefined): string {
  if (!type) return "—";
  return isKey ? `${type} (key)` : type;
}

/** Old → new type cell — for a pure add/remove there's only one side to show; for a `"changed"` field (type or key-ness differs) both sides are shown with an arrow. */
function FieldTypeCell({ field }: { field: TCdsFieldChange }): React.ReactElement {
  if (field.kind === "added") return <span className="mm-field-new">{typeLabel(field.newType, field.newKey)}</span>;
  if (field.kind === "removed") return <span className="mm-field-old">{typeLabel(field.oldType, field.oldKey)}</span>;
  return (
    <span>
      <span className="mm-field-old">{typeLabel(field.oldType, field.oldKey)}</span> → <span className="mm-field-new">{typeLabel(field.newType, field.newKey)}</span>
    </span>
  );
}

function FieldRow({ entity, field }: { entity: string; field: TCdsFieldChange }): React.ReactElement {
  return (
    <tr>
      <td>{entity}</td>
      <td>
        <span className={`mm-field-badge ${field.kind}`}>{FIELD_KIND_LABEL[field.kind]}</span>
      </td>
      <td>{field.field}</td>
      <td>
        <FieldTypeCell field={field} />
      </td>
    </tr>
  );
}

/**
 * One entity's table rows. A `"changed"` entity's differing fields are always shown flat (usually a
 * handful of rows). A whole-entity add/remove starts collapsed to one summary row instead — a brand
 * new entity can easily carry 20+ fields, which would otherwise dominate the table — click it to
 * expand the exact same per-field rows a `"changed"` entity shows, using `change.fields` (every field
 * of that entity, all itemized as `"added"`/`"removed"` to match — see `diffCdsEntities`'s doc
 * comment on the backend).
 */
function EntityRows({ change }: { change: TCdsEntityChange }): React.ReactElement {
  const [open, setOpen] = useState(false);

  if (change.kind === "changed") {
    return (
      <>
        {change.fields.map((field) => (
          <FieldRow key={field.field} entity={change.entity} field={field} />
        ))}
      </>
    );
  }

  return (
    <>
      <tr className="mm-entity-summary-row" onClick={() => setOpen((value) => !value)}>
        <td>
          <span className="mm-entity-caret">{open ? "▾" : "▸"}</span> {change.entity}
        </td>
        <td>
          <span className={`mm-field-badge ${change.kind}`}>{ENTITY_KIND_LABEL[change.kind]}</span>
        </td>
        <td colSpan={2} className="note">
          {change.fields.length} field{change.fields.length === 1 ? "" : "s"} — click to {open ? "collapse" : "view"}
        </td>
      </tr>
      {open && change.fields.map((field) => <FieldRow key={field.field} entity={change.entity} field={field} />)}
    </>
  );
}

function countBy<T extends { kind: string }>(items: T[], kind: string): number {
  return items.filter((item) => item.kind === kind).length;
}

function RepoReport({ repo }: { repo: TEntityChangesRepo }): React.ReactElement {
  const entityChanges = repo.entityChanges ?? [];
  const entitiesAdded = countBy(entityChanges, "added");
  const entitiesRemoved = countBy(entityChanges, "removed");
  const entitiesChanged = countBy(entityChanges, "changed");
  const allFields = entityChanges.flatMap((change) => change.fields);
  const fieldsAdded = countBy(allFields, "added");
  const fieldsRemoved = countBy(allFields, "removed");
  const fieldsChanged = countBy(allFields, "changed");

  return (
    <div className="dm-diff-repo">
      <div className="dm-diff-repo-head">
        <span className="dm-diff-repo-role">{repo.role}</span>
        <span>{repo.pathWithNamespace}</span>
      </div>

      {!entityChanges.length ? (
        <div className="note" style={{ padding: "var(--space-3)" }}>
          No entity/field changes detected in the .cds files that changed.
        </div>
      ) : (
        <>
          <div className="mm-repo-summary">
            {entitiesAdded > 0 && <span className="mm-stat mm-stat-added">+{entitiesAdded} entit{entitiesAdded === 1 ? "y" : "ies"}</span>}
            {entitiesRemoved > 0 && <span className="mm-stat mm-stat-removed">-{entitiesRemoved} entit{entitiesRemoved === 1 ? "y" : "ies"}</span>}
            {entitiesChanged > 0 && <span className="mm-stat">{entitiesChanged} entit{entitiesChanged === 1 ? "y" : "ies"} with field changes</span>}
            {fieldsAdded > 0 && <span className="mm-stat mm-stat-added">+{fieldsAdded} field{fieldsAdded === 1 ? "" : "s"}</span>}
            {fieldsRemoved > 0 && <span className="mm-stat mm-stat-removed">-{fieldsRemoved} field{fieldsRemoved === 1 ? "" : "s"}</span>}
            {fieldsChanged > 0 && <span className="mm-stat">{fieldsChanged} field{fieldsChanged === 1 ? "" : "s"} changed</span>}
          </div>
          <div className="table-scroll">
            <table className="mm-entity-table">
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Change</th>
                  <th>Field</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {entityChanges.map((change) => (
                  <EntityRows key={change.entity} change={change} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The field-level "what changed" report: per repo (db/srv/srv_process), which entities were added or
 * removed wholesale, and — for entities present on both sides — which fields were added, removed, or
 * changed type/key-ness. Built from `TCdsEntityChange[]` (see `diffCdsEntities` in `cds-entity-diff.ts`
 * on the backend), NOT from the raw text diff — this is the "what does this actually change on the
 * model" answer, complementary to (not a replacement for) the file-level text diff `DeployChangesPreview`
 * shows. Shared by Move Model (branch A → branch B) and Deploy Model's "Review changes" step (EDMX
 * upload → repo's default branch) — same report, two different sources of "what's on each side".
 */
export function EntityFieldChangesReport({ repos }: { repos: TEntityChangesRepo[] }): React.ReactElement {
  return (
    <div>
      {repos.map((repo) => (
        <RepoReport key={repo.pathWithNamespace} repo={repo} />
      ))}
    </div>
  );
}
