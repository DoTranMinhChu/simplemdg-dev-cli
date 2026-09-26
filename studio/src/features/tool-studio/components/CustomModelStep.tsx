import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { Icon } from "../../../components/common/Icon";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCdsModelEntity, TCustomModelEdit, TCustomModelEntityView, TCustomModelField } from "../api/tool-studio-api-client";
import { DeployChangesPreview } from "./DeployChangesPreview";
import { MergeRequestsPanel } from "./MergeRequestsPanel";
import { ErdWorkspace } from "./erd/ErdWorkspace";
import { FieldGrid } from "./erd/FieldGrid";
import type { TErdEdge, TErdEntity, TErdFocusRequest } from "./erd/erd-types";

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

// Custom entities are keyed by draft index (their name is free text the user is typing), generated ones by name.
const customId = (index: number): string => `custom:${index}`;
const generatedId = (name: string): string => `gen:${name}`;

/** Composition targets can be namespace-qualified (`MDG_F4.SearchHelpField`) while entity names in the file are not — match exact first, then by last segment. */
function resolveGeneratedName(target: string, names: ReadonlySet<string>): string | undefined {
  if (names.has(target)) return target;
  const short = target.split(".").pop() ?? target;
  return names.has(short) ? short : undefined;
}

/**
 * Builds the canvas: every custom entity, plus either all generated entities or (default) just the
 * ones that give the custom entities context — each attach target and its ancestor chain up to the
 * root — so an 80+-entity model doesn't bury the handful of custom ones being edited.
 */
function toErd(generated: TCdsModelEntity[], draft: TCustomModelEntityView[], showAllGenerated: boolean): { entities: TErdEntity[]; edges: TErdEdge[] } {
  const names = new Set(generated.map((entity) => entity.name));
  const parentsOf = new Map<string, string[]>();
  const compositionEdges: TErdEdge[] = [];
  for (const entity of generated) {
    for (const composition of entity.compositions) {
      const target = resolveGeneratedName(composition.target, names);
      if (!target) continue;
      parentsOf.set(target, [...(parentsOf.get(target) ?? []), entity.name]);
      compositionEdges.push({ id: `${entity.name}:${composition.field}`, source: generatedId(entity.name), target: generatedId(target), label: composition.field, cardinality: composition.cardinality, kind: "composition" });
    }
  }

  let shown = names;
  if (!showAllGenerated) {
    const related = new Set<string>();
    const stack = draft.map((entity) => entity.attachedTo).filter((name): name is string => Boolean(name && names.has(name)));
    while (stack.length) {
      const name = stack.pop()!;
      if (related.has(name)) continue;
      related.add(name);
      stack.push(...(parentsOf.get(name) ?? []));
    }
    shown = related;
  }

  const entities: TErdEntity[] = [
    ...generated
      .filter((entity) => shown.has(entity.name))
      .map((entity): TErdEntity => {
        const keys = new Set(entity.keyFields);
        return { id: generatedId(entity.name), title: entity.name, subtitle: entity.sourceFile, kind: "generated", fields: entity.fields.map((field) => ({ name: field.name, type: field.type, isKey: keys.has(field.name) })) };
      }),
    ...draft.map((entity, index): TErdEntity => ({ id: customId(index), title: entity.name, subtitle: "custom-model.cds", kind: "custom", fields: entity.fields })),
  ];
  const shownIds = new Set(entities.map((entity) => entity.id));
  const attachEdges: TErdEdge[] = draft.flatMap((entity, index) =>
    entity.attachedTo && shownIds.has(generatedId(entity.attachedTo))
      ? [{ id: `attach:${index}`, source: generatedId(entity.attachedTo), target: customId(index), label: "attached", cardinality: "many" as const, kind: "attach" as const }]
      : [],
  );
  return { entities, edges: [...compositionEdges.filter((edge) => shownIds.has(edge.source) && shownIds.has(edge.target)), ...attachEdges] };
}

function CustomEntityInspector({
  entity,
  attachOptions,
  onChange,
  onRemove,
  onOpenGenerated,
}: {
  entity: TCustomModelEntityView;
  attachOptions: Array<{ value: string; label: string; meta?: string }>;
  onChange: (next: TCustomModelEntityView) => void;
  onRemove: () => void;
  onOpenGenerated: (name: string) => void;
}): React.ReactElement {
  return (
    <div className="erd-inspector-body">
      <div className="erd-inspector-head">
        <div className="erd-inspector-kicker">Custom entity</div>
        <input className="input erd-inspector-title" placeholder="CustomEntityName" value={entity.name} onChange={(event) => onChange({ ...entity, name: event.target.value })} />
        <div className="erd-inspector-sub">saved to custom-model.cds</div>
      </div>

      <section className="erd-section">
        <div className="erd-section-title">Attached to</div>
        <SearchableSelect value={entity.attachedTo ?? ""} onChange={(value) => onChange({ ...entity, attachedTo: value })} placeholder="Attach to entity..." searchPlaceholder="Search entities..." options={attachOptions} />
        {entity.attachedTo && (
          <button type="button" className="erd-link" style={{ marginTop: 4 }} onClick={() => onOpenGenerated(entity.attachedTo!)}>
            Show {entity.attachedTo} on the diagram
          </button>
        )}
      </section>

      <section className="erd-section">
        <div className="erd-section-title">Fields · {entity.fields.length}</div>
        <FieldGrid fields={entity.fields} newField={emptyField} onChange={(fields) => onChange({ ...entity, fields })} />
      </section>

      <section className="erd-section erd-danger">
        <Button variant="danger" size="sm" onClick={onRemove}>
          Delete entity
        </Button>
      </section>
    </div>
  );
}

function GeneratedEntityInspector({
  entity,
  generatedNames,
  onAttachNew,
  onOpenGenerated,
}: {
  entity: TCdsModelEntity;
  generatedNames: ReadonlySet<string>;
  onAttachNew: () => void;
  onOpenGenerated: (name: string) => void;
}): React.ReactElement {
  const keys = new Set(entity.keyFields);
  return (
    <div className="erd-inspector-body">
      <div className="erd-inspector-head">
        <div className="erd-inspector-kicker">Generated entity · read-only</div>
        <div className="erd-inspector-name mono">{entity.name}</div>
        <div className="erd-inspector-sub">{entity.sourceFile} — regenerated from the EDMX, edit it by attaching a custom entity</div>
      </div>

      <section className="erd-section">
        <Button size="sm" onClick={onAttachNew}>
          <Icon name="plus" /> New custom entity attached here
        </Button>
      </section>

      <section className="erd-section">
        <div className="erd-section-title">Fields · {entity.fields.length}</div>
        <FieldGrid readOnly fields={entity.fields.map((field) => ({ name: field.name, type: field.type, isKey: keys.has(field.name) }))} />
      </section>

      {entity.compositions.length > 0 && (
        <section className="erd-section">
          <div className="erd-section-title">Compositions · {entity.compositions.length}</div>
          {entity.compositions.map((composition) => {
            const target = resolveGeneratedName(composition.target, generatedNames);
            return (
              <div className="erd-relation-head" key={composition.field}>
                <span className="mono erd-relation-name">{composition.field}</span>
                <span className="note">→</span>
                {target ? (
                  <button type="button" className="erd-link" onClick={() => onOpenGenerated(target)}>{target}</button>
                ) : (
                  <span className="mono">{composition.target}</span>
                )}
                <span className="erd-toolbar-spacer" />
                <span className="note">{composition.cardinality === "many" ? "many (*)" : "one (1)"}</span>
              </div>
            );
          })}
        </section>
      )}
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
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [focusRequest, setFocusRequest] = useState<TErdFocusRequest | undefined>();
  const [showAllGenerated, setShowAllGenerated] = useState(false);
  const preview = useAsync((edits: TCustomModelEdit[]) => toolStudioApi.previewCustomModelChanges({ deployTargetId, objectTypeSlug, edits }));
  const save = useAsync((edits: TCustomModelEdit[]) => toolStudioApi.saveCustomModelChanges({ deployTargetId, objectTypeSlug, edits }));

  useEffect(() => {
    preview.reset();
    save.reset();
    setSelectedId(undefined);
    void view.run().then((result) => {
      if (result && !result.error) {
        setDraft(cloneEntities(result.customEntities));
        if (result.customEntities.length) setSelectedId(customId(0));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployTargetId, objectTypeSlug]);

  const generated = view.data?.generatedEntities ?? [];
  const erd = useMemo(() => toErd(generated, draft, showAllGenerated), [generated, draft, showAllGenerated]);
  const generatedNames = useMemo(() => new Set(generated.map((entity) => entity.name)), [generated]);

  if (view.loading) {
    return (
      <EmptyState>
        <Spinner /> loading current model...
      </EmptyState>
    );
  }
  if (view.error || view.data?.error) return <div className="errbox">{view.error || view.data?.error}</div>;
  if (!view.data) return <EmptyState>No model found for this object type yet.</EmptyState>;

  const attachOptions = generated.map((entity) => ({ value: entity.name, label: entity.name, meta: `${entity.fields.length} field(s)` }));
  const edits = computeEdits(view.data.customEntities, draft);

  function focus(id: string): void {
    setSelectedId(id);
    setFocusRequest({ id, token: Date.now() });
  }

  function openGenerated(name: string): void {
    // A generated entity outside the "related" subset isn't on the canvas yet — reveal everything first.
    if (!erd.entities.some((entity) => entity.id === generatedId(name))) setShowAllGenerated(true);
    focus(generatedId(name));
  }

  function addCustomEntity(attachedTo?: string): void {
    setDraft((prev) => [...prev, { name: "", attachedTo, fields: [emptyField()] }]);
    focus(customId(draft.length));
  }

  const selectedCustomIndex = selectedId?.startsWith("custom:") ? Number(selectedId.slice("custom:".length)) : undefined;
  const selectedCustom = selectedCustomIndex !== undefined ? draft[selectedCustomIndex] : undefined;
  const selectedGenerated = selectedId?.startsWith("gen:") ? generated.find((entity) => generatedId(entity.name) === selectedId) : undefined;

  return (
    <div>
      <ErdWorkspace
        entities={erd.entities}
        edges={erd.edges}
        selectedId={selectedId}
        onSelect={setSelectedId}
        focusRequest={focusRequest}
        toolbarExtra={
          <label className="erd-toggle" title="Off: only the generated entities your custom entities attach to, plus their path up to the root">
            <input type="checkbox" checked={showAllGenerated} onChange={(event) => setShowAllGenerated(event.target.checked)} /> All {generated.length} generated
          </label>
        }
        actions={
          <Button size="sm" onClick={() => addCustomEntity()}>
            <Icon name="plus" /> Custom entity
          </Button>
        }
        inspector={
          selectedCustom && selectedCustomIndex !== undefined ? (
            <CustomEntityInspector
              entity={selectedCustom}
              attachOptions={attachOptions}
              onChange={(next) => setDraft((prev) => prev.map((existing, i) => (i === selectedCustomIndex ? next : existing)))}
              onRemove={() => {
                setDraft((prev) => prev.filter((_, i) => i !== selectedCustomIndex));
                setSelectedId(undefined);
              }}
              onOpenGenerated={openGenerated}
            />
          ) : selectedGenerated ? (
            <GeneratedEntityInspector entity={selectedGenerated} generatedNames={generatedNames} onAttachNew={() => addCustomEntity(selectedGenerated.name)} onOpenGenerated={openGenerated} />
          ) : (
            <div className="erd-inspector-empty note">
              {draft.length
                ? "Select an entity on the diagram."
                : `No custom entities yet — click “+ Custom entity”, or tick “All ${generated.length} generated” and pick an entity to attach one to.`}
            </div>
          )
        }
      />

      {edits.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div className="row">
            <span className="note">{edits.length} pending change{edits.length === 1 ? "" : "s"}</span>
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
