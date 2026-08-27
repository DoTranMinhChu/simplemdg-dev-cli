import { parseCdsEntities } from "./cds-model-reader";
import type { TCdsModelEntity } from "./cds-model-reader";

const CDS_FILE = /\.cds$/i;

/**
 * Field-level report row for one entity's `Move Model` diff — see `diffCdsEntities` below.
 * `oldType`/`newType`/`oldKey`/`newKey` are only set on the side(s) the field actually exists on
 * (a purely-added field has no `oldType`, a purely-removed field has no `newType`).
 */
export type TCdsFieldChange = {
  field: string;
  kind: "added" | "removed" | "changed";
  oldType?: string;
  newType?: string;
  oldKey?: boolean;
  newKey?: boolean;
};

/**
 * One entity's worth of field-level changes. `kind: "added"`/`"removed"` means the WHOLE entity
 * appeared/disappeared — `fields` still lists every one of its fields (each marked `"added"`/
 * `"removed"` to match the entity's own kind), so a caller can show exactly what's inside a new/
 * removed entity, not just its name. `kind: "changed"` means the entity exists on both sides but at
 * least one field differs, and `fields` carries exactly those differing fields (unchanged fields are
 * omitted).
 */
export type TCdsEntityChange = {
  entity: string;
  sourceFile: string;
  kind: "added" | "removed" | "changed";
  fields: TCdsFieldChange[];
};

/**
 * Parses `content` (via `parseCdsEntities`) and appends the result to `target` — the one accumulation
 * step both structural-preview callers need per changed file, before handing their accumulated
 * before/after entity lists to `diffCdsEntities` once per repo: Move Model's preview (`move-model-job.ts`,
 * reading two real branches) and Deploy Model's preview (`previewDeployModelChanges` below, reading
 * freshly-generated content against a repo's current default branch). No-ops for a non-`.cds` path or
 * `undefined` content (the file doesn't exist on this side — e.g. a brand new file being created).
 */
export function accumulateCdsEntities(target: TCdsModelEntity[], filePath: string, content: string | undefined): void {
  if (!content || !CDS_FILE.test(filePath)) return;
  target.push(...parseCdsEntities(content, filePath));
}

/**
 * Pure field-level diff between two parsed entity lists (see `parseCdsEntities` in
 * `cds-model-reader.ts`) — used by `move-model-job.ts` to turn "these `.cds` files changed between
 * branch A and branch B" into a human-readable "entity X gained field Y, lost field Z" report,
 * instead of making the user read a raw text diff to figure out what actually changed structurally.
 *
 * `oldEntities`/`newEntities` are typically every entity parsed out of every `.cds` file that
 * changed between the two branches (across `db/final`, `db/staging`, etc. — see the caller), keyed
 * here by entity name across all of them, not scoped to one file. An entity present on both sides
 * with no field differences is left out of the result entirely — this produces a change REPORT, not
 * a full model dump.
 *
 * If the same entity name appears twice within `oldEntities` (or `newEntities`) — real repos don't
 * do this, but nothing enforces it — the first occurrence wins and the rest are ignored.
 */
export function diffCdsEntities(oldEntities: TCdsModelEntity[], newEntities: TCdsModelEntity[]): TCdsEntityChange[] {
  const oldByName = new Map<string, TCdsModelEntity>();
  for (const entity of oldEntities) if (!oldByName.has(entity.name)) oldByName.set(entity.name, entity);
  const newByName = new Map<string, TCdsModelEntity>();
  for (const entity of newEntities) if (!newByName.has(entity.name)) newByName.set(entity.name, entity);

  const changes: TCdsEntityChange[] = [];
  const allNames = new Set([...oldByName.keys(), ...newByName.keys()]);

  for (const name of allNames) {
    const oldEntity = oldByName.get(name);
    const newEntity = newByName.get(name);

    if (!oldEntity && newEntity) {
      changes.push({ entity: name, sourceFile: newEntity.sourceFile, kind: "added", fields: entityFieldsAsChanges(newEntity, "added") });
      continue;
    }
    if (oldEntity && !newEntity) {
      changes.push({ entity: name, sourceFile: oldEntity.sourceFile, kind: "removed", fields: entityFieldsAsChanges(oldEntity, "removed") });
      continue;
    }
    if (!oldEntity || !newEntity) continue; // unreachable — satisfies TS narrowing above

    const fields = diffFields(oldEntity, newEntity);
    if (fields.length) changes.push({ entity: name, sourceFile: newEntity.sourceFile, kind: "changed", fields });
  }

  return changes.sort((a, b) => a.entity.localeCompare(b.entity));
}

/** Every field of a whole added/removed entity, reported as that same `kind` — lets a caller expand "AVSResponse: entity added" into its actual field list instead of just a name. */
function entityFieldsAsChanges(entity: TCdsModelEntity, kind: "added" | "removed"): TCdsFieldChange[] {
  const keyFields = new Set(entity.keyFields);
  return entity.fields
    .map((field) =>
      kind === "added"
        ? { field: field.name, kind, newType: field.type, newKey: keyFields.has(field.name) }
        : { field: field.name, kind, oldType: field.type, oldKey: keyFields.has(field.name) },
    )
    .sort((a, b) => a.field.localeCompare(b.field));
}

function diffFields(oldEntity: TCdsModelEntity, newEntity: TCdsModelEntity): TCdsFieldChange[] {
  const oldFields = new Map(oldEntity.fields.map((field) => [field.name, field]));
  const newFields = new Map(newEntity.fields.map((field) => [field.name, field]));
  const oldKeys = new Set(oldEntity.keyFields);
  const newKeys = new Set(newEntity.keyFields);

  const changes: TCdsFieldChange[] = [];
  const allNames = new Set([...oldFields.keys(), ...newFields.keys()]);

  for (const name of allNames) {
    const oldField = oldFields.get(name);
    const newField = newFields.get(name);

    if (!oldField && newField) {
      changes.push({ field: name, kind: "added", newType: newField.type, newKey: newKeys.has(name) });
      continue;
    }
    if (oldField && !newField) {
      changes.push({ field: name, kind: "removed", oldType: oldField.type, oldKey: oldKeys.has(name) });
      continue;
    }
    if (!oldField || !newField) continue; // unreachable — satisfies TS narrowing above

    const oldKey = oldKeys.has(name);
    const newKey = newKeys.has(name);
    if (oldField.type !== newField.type || oldKey !== newKey) {
      changes.push({ field: name, kind: "changed", oldType: oldField.type, newType: newField.type, oldKey, newKey });
    }
  }

  return changes.sort((a, b) => a.field.localeCompare(b.field));
}
