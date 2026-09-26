import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { Icon } from "../../../components/common/Icon";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TManualDraftEntity, TManualDraftField, TManualDraftRelation, TManualModelDraft } from "../api/tool-studio-api-client";
import { JoinRiskList } from "./JoinRiskList";
import { ErdWorkspace } from "./erd/ErdWorkspace";
import { FieldGrid } from "./erd/FieldGrid";
import type { TErdEdge, TErdEntity, TErdFocusRequest } from "./erd/erd-types";
import { buildErdTree } from "./erd/erd-layout";

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

function RelationRow({
  parent,
  relation,
  target,
  onChange,
  onRemove,
  onOpenTarget,
  isBackLink,
}: {
  parent: TManualDraftEntity;
  relation: TManualDraftRelation;
  target: TManualDraftEntity | undefined;
  onChange: (next: TManualDraftRelation) => void;
  onRemove: () => void;
  onOpenTarget: () => void;
  isBackLink: boolean;
}): React.ReactElement {
  const [showJoins, setShowJoins] = useState(false);
  return (
    <div className={`erd-relation${isBackLink ? " back-link" : ""}`}>
      <div className="erd-relation-head">
        <span className="mono erd-relation-name" title={relation.name}>{relation.name}</span>
        <span className="note">→</span>
        <button type="button" className="erd-link" onClick={onOpenTarget} title="Select this entity">
          {target?.label ?? relation.targetEntityId}
        </button>
        {isBackLink && (
          <span className="erd-tag" title="Points back up to an ancestor of this entity — hidden on the diagram unless Parent links is on">
            parent link
          </span>
        )}
        <span className="erd-toolbar-spacer" />
        <select className="erd-cell erd-cardinality" value={relation.cardinality} onChange={(event) => onChange({ ...relation, cardinality: event.target.value as "one" | "many" })} title="Cardinality">
          <option value="many">many (*)</option>
          <option value="one">one (1)</option>
        </select>
        <button type="button" className="erd-chip-btn" onClick={() => setShowJoins((value) => !value)} title="Extra join keys beyond the automatic objectID match">
          join keys{relation.joinPairs.length ? ` (${relation.joinPairs.length})` : ""} {showJoins ? "▴" : "▾"}
        </button>
        <button type="button" className="erd-row-delete" onClick={onRemove} title={`Remove ${relation.name}`}>
          <Icon name="x" />
        </button>
      </div>
      {showJoins && <JoinPairEditor parent={parent} target={target} relation={relation} onChange={onChange} />}
    </div>
  );
}

/** Right-hand inspector for the selected entity: name + path from the root, fields grid, child compositions (with join keys, parent links last), and "add child". */
function ManualEntityInspector({
  entity,
  isRoot,
  allEntities,
  onChange,
  onDelete,
  onAddRelation,
  onOpenEntity,
  ancestors,
  backLinkRelationNames,
}: {
  entity: TManualDraftEntity;
  isRoot: boolean;
  allEntities: TManualDraftEntity[];
  /** Root-first path down to (not including) this entity, from the diagram's spanning tree. */
  ancestors: TManualDraftEntity[];
  backLinkRelationNames: ReadonlySet<string>;
  onChange: (next: TManualDraftEntity) => void;
  onDelete: () => void;
  onAddRelation: (input: TAddChildInput) => void;
  onOpenEntity: (id: string) => void;
}): React.ReactElement {
  const [addingChild, setAddingChild] = useState(false);
  // Forward relations first — the children are what people come here to edit; parent links sort last.
  const relations = entity.relations
    .map((relation, index) => ({ relation, index, isBackLink: backLinkRelationNames.has(relation.name) }))
    .sort((a, b) => Number(a.isBackLink) - Number(b.isBackLink));
  const childCount = relations.filter((item) => !item.isBackLink).length;

  useEffect(() => setAddingChild(false), [entity.id]);

  return (
    <div className="erd-inspector-body">
      <div className="erd-inspector-head">
        <div className="erd-inspector-kicker">{isRoot ? "Root entity" : "Entity"}</div>
        <input className="input erd-inspector-title" value={entity.label} disabled={isRoot} onChange={(event) => onChange({ ...entity, label: event.target.value })} title={isRoot ? "The root's name is fixed to the object type" : undefined} />
        <div className="erd-inspector-sub mono" title={entity.id}>{entity.id}</div>
        {ancestors.length > 0 && (
          <div className="erd-breadcrumb" title="Path from the root entity">
            {ancestors.map((ancestor) => (
              <span key={ancestor.id}>
                <button type="button" className="erd-link" onClick={() => onOpenEntity(ancestor.id)}>{ancestor.label}</button>
                <span className="erd-breadcrumb-sep">›</span>
              </span>
            ))}
            <span>{entity.label}</span>
          </div>
        )}
      </div>

      <section className="erd-section">
        <div className="erd-section-title">Fields · {entity.fields.length}</div>
        <FieldGrid
          fields={entity.fields}
          lockedFieldNames={LOCKED_FIELDS}
          newField={(): TManualDraftField => ({ name: "", type: "String(10)", isKey: false })}
          onChange={(fields) => onChange({ ...entity, fields })}
        />
      </section>

      <section className="erd-section">
        <div className="erd-section-title">
          Child entities · {childCount}
          {relations.length > childCount ? ` (+${relations.length - childCount} parent link${relations.length - childCount === 1 ? "" : "s"})` : ""}
        </div>
        {!childCount && <div className="note">No child entities yet.</div>}
        {relations.map(({ relation, index, isBackLink }) => (
          <RelationRow
            key={`${relation.name}-${index}`}
            isBackLink={isBackLink}
            parent={entity}
            relation={relation}
            target={allEntities.find((candidate) => candidate.id === relation.targetEntityId)}
            onChange={(next) => onChange({ ...entity, relations: entity.relations.map((existing, i) => (i === index ? next : existing)) })}
            onRemove={() => onChange({ ...entity, relations: entity.relations.filter((_, i) => i !== index) })}
            onOpenTarget={() => onOpenEntity(relation.targetEntityId)}
          />
        ))}
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
          <button type="button" className="erd-add-row" onClick={() => setAddingChild(true)}>
            <Icon name="plus" /> Add child entity
          </button>
        )}
      </section>

      {!isRoot && (
        <section className="erd-section erd-danger">
          <Button variant="danger" size="sm" onClick={onDelete}>
            Delete entity
          </Button>
          <span className="note">Also removes every composition pointing at it.</span>
        </section>
      )}
    </div>
  );
}

/** `objectID` is mandatory on every manual-model entity (see `createEmptyDraftEntity`) — shown, but never renamable or removable. */
const LOCKED_FIELDS: ReadonlySet<string> = new Set(["objectID"]);

function toErd(draft: TManualModelDraft): { entities: TErdEntity[]; edges: TErdEdge[] } {
  const ids = new Set(draft.entities.map((entity) => entity.id));
  return {
    entities: draft.entities.map((entity) => ({ id: entity.id, title: entity.label, subtitle: entity.id.split(".").pop(), kind: entity.id === draft.rootEntityId ? "root" : "entity", fields: entity.fields })),
    edges: draft.entities.flatMap((entity) =>
      entity.relations
        .filter((relation) => ids.has(relation.targetEntityId))
        .map((relation) => ({ id: `${entity.id}:${relation.name}`, source: entity.id, target: relation.targetEntityId, label: relation.name, cardinality: relation.cardinality, kind: "composition" as const })),
    ),
  };
}

export function ManualModelEditor({ deployTargetId, objectTypeSlug, onDraftReady }: { deployTargetId: string; objectTypeSlug: string; onDraftReady: (result: { uploadId: string; entityName: string }) => void }): React.ReactElement {
  const view = useAsync(() => toolStudioApi.getManualModelView(deployTargetId, objectTypeSlug));
  const [draft, setDraft] = useState<TManualModelDraft | undefined>();
  const [namespacePrefix, setNamespacePrefix] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [focusRequest, setFocusRequest] = useState<TErdFocusRequest | undefined>();
  const validate = useAsync((currentDraft: TManualModelDraft) => toolStudioApi.validateManualModel({ deployTargetId, objectTypeSlug, draft: currentDraft }));
  const saveDraft = useAsync((currentDraft: TManualModelDraft) => toolStudioApi.saveManualModelDraft({ deployTargetId, objectTypeSlug, draft: currentDraft }));

  useEffect(() => {
    setDraft(undefined);
    setSelectedId(undefined);
    validate.reset();
    saveDraft.reset();
    void view.run().then((result) => {
      if (result && !result.error) {
        setDraft(result.draft);
        setNamespacePrefix(result.namespacePrefix);
        setSelectedId(result.draft.rootEntityId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployTargetId, objectTypeSlug]);

  const erd = useMemo(() => (draft ? toErd(draft) : { entities: [], edges: [] }), [draft]);
  // Same spanning tree the canvas lays out — drives the inspector's breadcrumb and "parent link" tags.
  const tree = useMemo(() => buildErdTree(erd.entities, erd.edges, draft?.rootEntityId), [erd, draft?.rootEntityId]);

  if (view.loading || (!draft && !view.error && !view.data?.error)) {
    return (
      <EmptyState>
        <Spinner /> loading current model...
      </EmptyState>
    );
  }
  if (view.error || view.data?.error || !draft) return <div className="errbox">{view.error || view.data?.error || "Failed to load the current model."}</div>;

  function openEntity(id: string): void {
    setSelectedId(id);
    setFocusRequest({ id, token: Date.now() });
  }

  function updateEntity(id: string, updater: (entity: TManualDraftEntity) => TManualDraftEntity): void {
    setDraft((prev) => (prev ? { ...prev, entities: prev.entities.map((entity) => (entity.id === id ? updater(entity) : entity)) } : prev));
  }

  function deleteEntity(id: string): void {
    setDraft((prev) => {
      if (!prev || id === prev.rootEntityId) return prev;
      return { ...prev, entities: prev.entities.filter((entity) => entity.id !== id).map((entity) => ({ ...entity, relations: entity.relations.filter((relation) => relation.targetEntityId !== id) })) };
    });
    setSelectedId(draft?.rootEntityId);
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

  const selected = draft.entities.find((entity) => entity.id === selectedId);
  const byId = new Map(draft.entities.map((entity) => [entity.id, entity]));
  const ancestors: TManualDraftEntity[] = [];
  for (let current = selected && tree.parentOf.get(selected.id); current; current = tree.parentOf.get(current)) {
    const ancestor = byId.get(current);
    if (ancestor) ancestors.unshift(ancestor);
  }
  const backLinkRelationNames = new Set(selected ? selected.relations.filter((relation) => tree.backLinkEdgeIds.has(`${selected.id}:${relation.name}`)).map((relation) => relation.name) : []);

  return (
    <div>
      {!view.data?.hasExistingModel && (
        <div className="note" style={{ marginBottom: 12 }}>
          No model archived yet for this object type — starting from a fresh root entity ({view.data?.archivePath} doesn't exist yet).
        </div>
      )}

      <ErdWorkspace
        entities={erd.entities}
        edges={erd.edges}
        rootId={draft.rootEntityId}
        selectedId={selectedId}
        onSelect={setSelectedId}
        focusRequest={focusRequest}
        actions={
          <>
            <Button variant="sec" size="sm" onClick={() => void validate.run(draft)} disabled={validate.loading}>
              {validate.loading ? <Spinner /> : "Validate"}
            </Button>
            <Button
              size="sm"
              onClick={async () => {
                const result = await saveDraft.run(draft);
                if (result?.uploadId && result.entityName) onDraftReady({ uploadId: result.uploadId, entityName: result.entityName });
              }}
              disabled={saveDraft.loading}
            >
              {saveDraft.loading ? <Spinner /> : "Use this model"}
            </Button>
          </>
        }
        inspector={
          selected ? (
            <ManualEntityInspector
              entity={selected}
              isRoot={selected.id === draft.rootEntityId}
              allEntities={draft.entities}
              onChange={(next) => updateEntity(selected.id, () => next)}
              onDelete={() => deleteEntity(selected.id)}
              onAddRelation={(input) => addChildRelation(selected.id, input)}
              onOpenEntity={openEntity}
              ancestors={ancestors}
              backLinkRelationNames={backLinkRelationNames}
            />
          ) : (
            <div className="erd-inspector-empty note">Select an entity on the diagram to edit it.</div>
          )
        }
      />

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
