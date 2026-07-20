import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { Collapsible } from "../../../components/common/Collapsible";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCustomModelEdit, TCustomModelEntityView, TCustomModelField } from "../api/tool-studio-api-client";
import { DeployChangesPreview } from "./DeployChangesPreview";
import { MergeRequestsPanel } from "./MergeRequestsPanel";

const FIELD_TYPES = ["String", "String(10)", "String(18)", "String(40)", "LargeString", "Integer", "Decimal(15,2)", "Boolean", "Date", "DateTime", "UUID"];

function emptyField(): TCustomModelField {
  return { name: "", type: "String", isKey: false, i18nLabel: "" };
}

function cloneEntities(entities: TCustomModelEntityView[]): TCustomModelEntityView[] {
  return entities.map((entity) => ({ ...entity, fields: entity.fields.map((field) => ({ ...field })) }));
}

/**
 * Diffs the free-form draft against what was loaded and turns it into entity-level
 * add/update/delete edits — the backend (`buildCustomModelCommitActions`) always regenerates a
 * whole entity from `fields`/`attachedTo` in one op, so field-level add/update/delete ops exist in
 * the API for completeness but aren't needed from this UI.
 */
function computeEdits(original: TCustomModelEntityView[], draft: TCustomModelEntityView[]): TCustomModelEdit[] {
  const edits: TCustomModelEdit[] = [];
  const originalByName = new Map(original.map((entity) => [entity.name, entity]));
  const draftNames = new Set(draft.map((entity) => entity.name));

  for (const entity of draft) {
    if (!entity.name.trim() || entity.fields.some((field) => !field.name.trim())) continue; // still being typed
    const before = originalByName.get(entity.name);
    if (!before) {
      edits.push({ op: "add-entity", name: entity.name, attachedTo: entity.attachedTo ?? "", fields: entity.fields });
    } else if (JSON.stringify(before) !== JSON.stringify(entity)) {
      edits.push({ op: "update-entity", name: entity.name, attachedTo: entity.attachedTo ?? "", fields: entity.fields });
    }
  }
  for (const entity of original) {
    if (!draftNames.has(entity.name)) edits.push({ op: "delete-entity", name: entity.name });
  }
  return edits;
}

function FieldRow({ field, onChange, onRemove }: { field: TCustomModelField; onChange: (next: TCustomModelField) => void; onRemove: () => void }): React.ReactElement {
  return (
    <div className="row" style={{ gap: 8, marginBottom: 6, alignItems: "center" }}>
      <input className="input" style={{ flex: 1 }} placeholder="fieldName" value={field.name} onChange={(event) => onChange({ ...field, name: event.target.value })} />
      <select className="select" style={{ width: 140 }} value={field.type} onChange={(event) => onChange({ ...field, type: event.target.value })}>
        {FIELD_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={field.isKey} onChange={(event) => onChange({ ...field, isKey: event.target.checked })} /> key
      </label>
      <input className="input" style={{ flex: 1 }} placeholder="i18n label" value={field.i18nLabel ?? ""} onChange={(event) => onChange({ ...field, i18nLabel: event.target.value })} />
      <Button variant="sec" size="sm" onClick={onRemove}>
        ✕
      </Button>
    </div>
  );
}

function EntityCard({
  entity,
  attachOptions,
  onChange,
  onRemove,
}: {
  entity: TCustomModelEntityView;
  attachOptions: Array<{ value: string; label: string; meta?: string }>;
  onChange: (next: TCustomModelEntityView) => void;
  onRemove: () => void;
}): React.ReactElement {
  return (
    <div className="ts-card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <input className="input" style={{ flex: 1 }} placeholder="CustomEntityName" value={entity.name} onChange={(event) => onChange({ ...entity, name: event.target.value })} />
        <div style={{ flex: 1 }}>
          <SearchableSelect
            value={entity.attachedTo ?? ""}
            onChange={(value) => onChange({ ...entity, attachedTo: value })}
            placeholder="Attach to entity..."
            searchPlaceholder="Search entities..."
            options={attachOptions}
          />
        </div>
        <Button variant="sec" size="sm" onClick={onRemove}>
          Delete entity
        </Button>
      </div>
      {entity.fields.map((field, index) => (
        <FieldRow
          key={index}
          field={field}
          onChange={(next) => onChange({ ...entity, fields: entity.fields.map((existing, i) => (i === index ? next : existing)) })}
          onRemove={() => onChange({ ...entity, fields: entity.fields.filter((_, i) => i !== index) })}
        />
      ))}
      <Button variant="sec" size="sm" onClick={() => onChange({ ...entity, fields: [...entity.fields, emptyField()] })}>
        + Add field
      </Button>
    </div>
  );
}

/**
 * Lets the user view the currently-generated model (`db/final/*-model.cds`) alongside any existing
 * `custom-model.cds` entities, and add/edit/delete custom entities + fields + their attachment to
 * an existing entity — without hand-editing CDS. Saving opens a branch + MR the same way the main
 * EDMX deploy flow does (see `custom-model-editor.ts`/`custom-model-routes.ts`); the composition it
 * wires in survives every future EDMX re-upload because of the preservation fix in
 * `custom-model-preserver.ts`.
 */
export function CustomModelStep({ deployTargetId, objectTypeSlug }: { deployTargetId: string; objectTypeSlug: string }): React.ReactElement {
  const view = useAsync(() => toolStudioApi.getCustomModelView(deployTargetId, objectTypeSlug));
  const [draft, setDraft] = useState<TCustomModelEntityView[]>([]);
  const preview = useAsync((edits: TCustomModelEdit[]) => toolStudioApi.previewCustomModelChanges({ deployTargetId, objectTypeSlug, edits }));
  const save = useAsync((edits: TCustomModelEdit[]) => toolStudioApi.saveCustomModelChanges({ deployTargetId, objectTypeSlug, edits }));

  useEffect(() => {
    preview.reset();
    save.reset();
    void view.run().then((result) => {
      if (result && !result.error) setDraft(cloneEntities(result.customEntities));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployTargetId, objectTypeSlug]);

  if (view.loading) {
    return (
      <EmptyState>
        <Spinner /> loading current model...
      </EmptyState>
    );
  }
  if (view.error || view.data?.error) return <div className="errbox">{view.error || view.data?.error}</div>;
  if (!view.data) return <EmptyState>No model found for this object type yet.</EmptyState>;

  const attachOptions = view.data.generatedEntities.map((entity) => ({ value: entity.name, label: entity.name, meta: `${entity.fields.length} field(s)` }));
  const edits = computeEdits(view.data.customEntities, draft);

  return (
    <div>
      <Collapsible summary={`${view.data.generatedEntities.length} generated entit${view.data.generatedEntities.length === 1 ? "y" : "ies"} in the current model — click to view`}>
        <ul className="dm-rename-alert-list">
          {view.data.generatedEntities.map((entity) => (
            <li key={entity.name}>
              <code>{entity.name}</code> — {entity.fields.length} field(s), {entity.compositions.length} relation(s) ({entity.sourceFile})
            </li>
          ))}
        </ul>
      </Collapsible>

      <div style={{ marginTop: 12 }}>
        {draft.map((entity, index) => (
          <EntityCard
            key={index}
            entity={entity}
            attachOptions={attachOptions}
            onChange={(next) => setDraft((prev) => prev.map((existing, i) => (i === index ? next : existing)))}
            onRemove={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
          />
        ))}
      </div>

      <Button variant="sec" onClick={() => setDraft((prev) => [...prev, { name: "", attachedTo: undefined, fields: [emptyField()] }])}>
        + Add custom entity
      </Button>

      {edits.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="row">
            <Button variant="sec" onClick={() => void preview.run(edits)} disabled={preview.loading}>
              {preview.loading ? <Spinner /> : "Preview changes"}
            </Button>
            <Button
              onClick={async () => {
                const result = await save.run(edits);
                if (result && !result.error) {
                  const refreshed = await view.run();
                  if (refreshed && !refreshed.error) setDraft(cloneEntities(refreshed.customEntities));
                }
              }}
              disabled={save.loading}
            >
              {save.loading ? <Spinner /> : "Save (branch + MR)"}
            </Button>
          </div>

          {preview.error && (
            <div className="errbox" style={{ marginTop: 8 }}>
              {preview.error}
            </div>
          )}
          {preview.data && !preview.data.error && (
            <div style={{ marginTop: 12 }}>
              <DeployChangesPreview result={preview.data} />
            </div>
          )}

          {save.error && (
            <div className="errbox" style={{ marginTop: 8 }}>
              {save.error}
            </div>
          )}
          {save.data?.error && (
            <div className="errbox" style={{ marginTop: 8 }}>
              {save.data.error}
            </div>
          )}
          {save.data?.noChange && (
            <div className="note" style={{ marginTop: 8 }}>
              No changes — nothing to merge.
            </div>
          )}
          {save.data?.mergeRequest && (
            <div style={{ marginTop: 12 }}>
              <MergeRequestsPanel mergeRequests={[{ role: "db", ...save.data.mergeRequest }]} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
