import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TManualDraftEntity, TManualDraftField, TManualDraftRelation, TManualModelDraft } from "../api/tool-studio-api-client";
import { CdsFieldRow } from "./CdsFieldRow";
import { JoinRiskList } from "./JoinRiskList";

/**
 * Alternative to Deploy Model's "Upload EDMX" tab for object types that no longer have an EDMX to
 * upload — loads the object type's current model (via `getManualModelView`, which parses whatever
 * is currently archived at `srv|db/external/MDG_<code>.csn`, or starts a fresh single-root-entity
 * draft when nothing's archived yet), lets the user add/edit/delete entities, fields, and
 * compositions at any depth, then hands the result to the *same* preview/deploy pipeline the EDMX
 * path uses (see `csn-manual-editor.ts`'s doc comment) via `saveManualModelDraft` → `uploadId`.
 */

function sanitizeLabelToTechnicalName(label: string): string {
  return label.replace(/[^A-Za-z0-9]/g, "") || "Entity";
}

/** Mirrors `mintEntityId` in `src/core/deploy/csn-manual-editor.ts` — kept in sync by hand, same convention as every other frontend/backend type mirror in this file's API client. */
function mintEntityId(namespacePrefix: string, label: string, existingIds: ReadonlySet<string>): string {
  const base = sanitizeLabelToTechnicalName(label);
  let candidate = `${namespacePrefix}.${base}`;
  for (let suffix = 2; existingIds.has(candidate); suffix += 1) candidate = `${namespacePrefix}.${base}${suffix}`;
  return candidate;
}

function mintRelationName(label: string, existingNames: ReadonlySet<string>): string {
  const base = `to_${sanitizeLabelToTechnicalName(label)}`;
  let candidate = base;
  for (let suffix = 2; existingNames.has(candidate); suffix += 1) candidate = `${base}${suffix}`;
  return candidate;
}

/** Mirrors `createEmptyDraftEntity` in `csn-manual-editor.ts` — every entity always carries a locked `objectID` key field (see that function's doc comment for why). */
function createEmptyDraftEntity(id: string, label: string): TManualDraftEntity {
  return { id, label, fields: [{ name: "objectID", type: "String(10)", isKey: true }], relations: [] };
}

type TAddChildInput = { mode: "new" | "existing"; label: string; existingId?: string; cardinality: "one" | "many" };

function AddChildForm({ parent, allEntities, onAdd, onCancel }: { parent: TManualDraftEntity; allEntities: TManualDraftEntity[]; onAdd: (input: TAddChildInput) => void; onCancel: () => void }): React.ReactElement {
  const existingOptions = allEntities.filter((entity) => entity.id !== parent.id).map((entity) => ({ value: entity.id, label: entity.label, meta: entity.id }));
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [label, setLabel] = useState("");
  const [existingId, setExistingId] = useState("");
  const [cardinality, setCardinality] = useState<"one" | "many">("many");

  return (
    <div className="ts-card" style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 12, marginBottom: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New entity
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} disabled={!existingOptions.length} /> Existing entity
        </label>
      </div>
      {mode === "new" ? (
        <input className="input" placeholder="Entity name (business label)" value={label} onChange={(event) => setLabel(event.target.value)} />
      ) : (
        <SearchableSelect value={existingId} onChange={setExistingId} placeholder="Select entity..." searchPlaceholder="Search entities..." options={existingOptions} />
      )}
      <div className="row" style={{ marginTop: 8, gap: 8, alignItems: "center" }}>
        <label style={{ fontSize: 12 }}>Cardinality</label>
        <select className="select" value={cardinality} onChange={(event) => setCardinality(event.target.value as "one" | "many")}>
          <option value="many">Composition of many</option>
          <option value="one">Composition of one</option>
        </select>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <Button
          size="sm"
          disabled={mode === "new" ? !label.trim() : !existingId}
          onClick={() =>
            onAdd({ mode, label: mode === "new" ? label.trim() : allEntities.find((entity) => entity.id === existingId)?.label ?? "", existingId: mode === "existing" ? existingId : undefined, cardinality })
          }
        >
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Per-composition editor for the extra join key pairs beyond the automatic `objectID` match (see `buildOnTokensFromJoinPairs`'s doc comment in `csn-manual-editor.ts`) — most compositions need none of these at all. */
function JoinPairEditor({ parent, target, relation, onChange }: { parent: TManualDraftEntity; target: TManualDraftEntity | undefined; relation: TManualDraftRelation; onChange: (next: TManualDraftRelation) => void }): React.ReactElement {
  const parentFieldOptions = parent.fields.filter((field) => field.name !== "objectID").map((field) => ({ value: field.name, label: field.name }));
  const childFieldOptions = (target?.fields ?? []).filter((field) => field.name !== "objectID").map((field) => ({ value: field.name, label: field.name }));

  return (
    <div style={{ marginTop: 6 }}>
      <div className="note" style={{ marginBottom: 4 }}>
        Extra join keys beyond the automatic <code>objectID</code> match (most compositions need none):
      </div>
      {relation.joinPairs.map((pair, index) => (
        <div className="row" key={index} style={{ gap: 8, marginBottom: 4, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <SearchableSelect
              value={pair.parentField}
              onChange={(value) => onChange({ ...relation, joinPairs: relation.joinPairs.map((p, i) => (i === index ? { ...p, parentField: value } : p)) })}
              placeholder="parent field"
              searchPlaceholder="Search..."
              options={parentFieldOptions}
            />
          </div>
          <span className="note">=</span>
          <div style={{ flex: 1 }}>
            <SearchableSelect
              value={pair.childField}
              onChange={(value) => onChange({ ...relation, joinPairs: relation.joinPairs.map((p, i) => (i === index ? { ...p, childField: value } : p)) })}
              placeholder="child field"
              searchPlaceholder="Search..."
              options={childFieldOptions}
            />
          </div>
          <Button variant="sec" size="sm" onClick={() => onChange({ ...relation, joinPairs: relation.joinPairs.filter((_, i) => i !== index) })}>
            ✕
          </Button>
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ ...relation, joinPairs: [...relation.joinPairs, { parentField: parentFieldOptions[0]?.value ?? "", childField: childFieldOptions[0]?.value ?? "" }] })}
      >
        + Add join pair
      </Button>
    </div>
  );
}

function ManualEntityCard({
  entity,
  isRoot,
  allEntities,
  onChangeLabel,
  onDelete,
  onUpdateField,
  onAddField,
  onRemoveField,
  onUpdateRelation,
  onRemoveRelation,
  onAddRelation,
}: {
  entity: TManualDraftEntity;
  isRoot: boolean;
  allEntities: TManualDraftEntity[];
  onChangeLabel: (label: string) => void;
  onDelete: () => void;
  onUpdateField: (index: number, next: TManualDraftField) => void;
  onAddField: () => void;
  onRemoveField: (index: number) => void;
  onUpdateRelation: (index: number, next: TManualDraftRelation) => void;
  onRemoveRelation: (index: number) => void;
  onAddRelation: (input: TAddChildInput) => void;
}): React.ReactElement {
  const [addingChild, setAddingChild] = useState(false);

  return (
    <div className="ts-card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
        <input className="input" style={{ flex: 1 }} value={entity.label} disabled={isRoot} onChange={(event) => onChangeLabel(event.target.value)} />
        {isRoot ? <span className="note">ROOT — name fixed to the object type</span> : <span className="note">{entity.id}</span>}
        {!isRoot && (
          <Button variant="sec" size="sm" onClick={onDelete}>
            Delete entity
          </Button>
        )}
      </div>

      {entity.fields.map((field, index) => (
        <CdsFieldRow key={index} field={field} disableNameEdit={field.name === "objectID"} onRemove={field.name === "objectID" ? undefined : () => onRemoveField(index)} onChange={(next) => onUpdateField(index, next)} />
      ))}
      <Button variant="sec" size="sm" onClick={onAddField}>
        + Add field
      </Button>

      {entity.relations.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="note" style={{ marginBottom: 6 }}>
            Child compositions
          </div>
          {entity.relations.map((relation, index) => {
            const target = allEntities.find((candidate) => candidate.id === relation.targetEntityId);
            return (
              <div key={index} className="ts-card" style={{ marginBottom: 8 }}>
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <strong>{relation.name}</strong>
                  <span className="note">→ {target?.label ?? relation.targetEntityId}</span>
                  <select className="select" value={relation.cardinality} onChange={(event) => onUpdateRelation(index, { ...relation, cardinality: event.target.value as "one" | "many" })}>
                    <option value="many">Composition of many</option>
                    <option value="one">Composition of one</option>
                  </select>
                  <Button variant="sec" size="sm" onClick={() => onRemoveRelation(index)}>
                    Remove
                  </Button>
                </div>
                <JoinPairEditor parent={entity} target={target} relation={relation} onChange={(next) => onUpdateRelation(index, next)} />
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        {addingChild ? (
          <AddChildForm
            parent={entity}
            allEntities={allEntities}
            onCancel={() => setAddingChild(false)}
            onAdd={(input) => {
              onAddRelation(input);
              setAddingChild(false);
            }}
          />
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAddingChild(true)}>
            + Add child entity
          </Button>
        )}
      </div>
    </div>
  );
}

export function ManualModelEditor({ deployTargetId, objectTypeSlug, onDraftReady }: { deployTargetId: string; objectTypeSlug: string; onDraftReady: (result: { uploadId: string; entityName: string }) => void }): React.ReactElement {
  const view = useAsync(() => toolStudioApi.getManualModelView(deployTargetId, objectTypeSlug));
  const [draft, setDraft] = useState<TManualModelDraft | undefined>();
  const [namespacePrefix, setNamespacePrefix] = useState("");
  const validate = useAsync((currentDraft: TManualModelDraft) => toolStudioApi.validateManualModel({ deployTargetId, objectTypeSlug, draft: currentDraft }));
  const saveDraft = useAsync((currentDraft: TManualModelDraft) => toolStudioApi.saveManualModelDraft({ deployTargetId, objectTypeSlug, draft: currentDraft }));

  useEffect(() => {
    setDraft(undefined);
    validate.reset();
    saveDraft.reset();
    void view.run().then((result) => {
      if (result && !result.error) {
        setDraft(result.draft);
        setNamespacePrefix(result.namespacePrefix);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployTargetId, objectTypeSlug]);

  if (view.loading || (!draft && !view.error && !view.data?.error)) {
    return (
      <EmptyState>
        <Spinner /> loading current model...
      </EmptyState>
    );
  }
  if (view.error || view.data?.error || !draft) return <div className="errbox">{view.error || view.data?.error || "Failed to load the current model."}</div>;

  function updateEntity(id: string, updater: (entity: TManualDraftEntity) => TManualDraftEntity): void {
    setDraft((prev) => (prev ? { ...prev, entities: prev.entities.map((entity) => (entity.id === id ? updater(entity) : entity)) } : prev));
  }

  function deleteEntity(id: string): void {
    setDraft((prev) => {
      if (!prev || id === prev.rootEntityId) return prev;
      return { ...prev, entities: prev.entities.filter((entity) => entity.id !== id).map((entity) => ({ ...entity, relations: entity.relations.filter((relation) => relation.targetEntityId !== id) })) };
    });
  }

  function addChildRelation(parentId: string, input: TAddChildInput): void {
    setDraft((prev) => {
      if (!prev) return prev;
      const parent = prev.entities.find((entity) => entity.id === parentId);
      if (!parent) return prev;

      let entities = prev.entities;
      let targetEntity: TManualDraftEntity | undefined;

      if (input.mode === "new") {
        const targetId = mintEntityId(namespacePrefix, input.label, new Set(entities.map((entity) => entity.id)));
        targetEntity = createEmptyDraftEntity(targetId, input.label);
        entities = [...entities, targetEntity];
      } else {
        targetEntity = entities.find((entity) => entity.id === input.existingId);
      }
      if (!targetEntity) return prev;

      const relationName = mintRelationName(input.label, new Set(parent.relations.map((relation) => relation.name)));
      // Suggest the parent's OWN key fields (beyond the implicit `objectID` join) that already have a same-named field on the target — the common real case (e.g. a multi-key parent/child pair).
      const targetFieldNames = new Set(targetEntity.fields.map((field) => field.name));
      const joinPairs = parent.fields.filter((field) => field.isKey && field.name !== "objectID" && targetFieldNames.has(field.name)).map((field) => ({ parentField: field.name, childField: field.name }));

      entities = entities.map((entity) =>
        entity.id === parentId ? { ...entity, relations: [...entity.relations, { name: relationName, targetEntityId: targetEntity!.id, cardinality: input.cardinality, joinPairs }] } : entity,
      );
      return { ...prev, entities };
    });
  }

  return (
    <div>
      {!view.data?.hasExistingModel && (
        <div className="note" style={{ marginBottom: 12 }}>
          No model archived yet for this object type — starting from a fresh root entity ({view.data?.archivePath} doesn't exist yet).
        </div>
      )}

      {draft.entities.map((entity) => (
        <ManualEntityCard
          key={entity.id}
          entity={entity}
          isRoot={entity.id === draft.rootEntityId}
          allEntities={draft.entities}
          onChangeLabel={(label) => updateEntity(entity.id, (current) => ({ ...current, label }))}
          onDelete={() => deleteEntity(entity.id)}
          onUpdateField={(index, next) => updateEntity(entity.id, (current) => ({ ...current, fields: current.fields.map((field, i) => (i === index ? next : field)) }))}
          onAddField={() => updateEntity(entity.id, (current) => ({ ...current, fields: [...current.fields, { name: "", type: "String(10)", isKey: false }] }))}
          onRemoveField={(index) => updateEntity(entity.id, (current) => ({ ...current, fields: current.fields.filter((_, i) => i !== index) }))}
          onUpdateRelation={(index, next) => updateEntity(entity.id, (current) => ({ ...current, relations: current.relations.map((relation, i) => (i === index ? next : relation)) }))}
          onRemoveRelation={(index) => updateEntity(entity.id, (current) => ({ ...current, relations: current.relations.filter((_, i) => i !== index) }))}
          onAddRelation={(input) => addChildRelation(entity.id, input)}
        />
      ))}

      <div className="row" style={{ marginTop: 12 }}>
        <Button variant="sec" onClick={() => void validate.run(draft)} disabled={validate.loading}>
          {validate.loading ? <Spinner /> : "Validate"}
        </Button>
        <Button
          onClick={async () => {
            const result = await saveDraft.run(draft);
            if (result?.uploadId && result.entityName) onDraftReady({ uploadId: result.uploadId, entityName: result.entityName });
          }}
          disabled={saveDraft.loading}
        >
          {saveDraft.loading ? <Spinner /> : "Use this model"}
        </Button>
      </div>

      {validate.error && <div className="errbox" style={{ marginTop: 8 }}>{validate.error}</div>}
      {validate.data?.error && <div className="errbox" style={{ marginTop: 8 }}>{validate.data.error}</div>}
      {validate.data && !validate.data.error && validate.data.joinRisks.length === 0 && <div className="note" style={{ marginTop: 8 }}>No composition join warnings.</div>}
      {validate.data && validate.data.joinRisks.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <JoinRiskList risks={validate.data.joinRisks} note="double check the extra join keys on the relations flagged below." />
        </div>
      )}

      {saveDraft.error && <div className="errbox" style={{ marginTop: 8 }}>{saveDraft.error}</div>}
      {saveDraft.data?.error && <div className="errbox" style={{ marginTop: 8 }}>{saveDraft.data.error}</div>}
      {saveDraft.data?.uploadId && <div className="note" style={{ marginTop: 8 }}>Model ready — see Review changes below.</div>}
    </div>
  );
}
