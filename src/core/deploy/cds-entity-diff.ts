import { parseCdsEntities } from "./cds-model-reader";
import type { TCdsModelEntity } from "./cds-model-reader";
import { cdsTypeToDisplayString } from "./csn-manual-editor";
import type { TCsnContent } from "./csn-model-types";

const CDS_FILE = /\.cds$/i;
const CSN_FILE = /\.csn$/i;

/**
 * Parses a raw `cds import`-produced CSN JSON (see `csn-model-types.ts`) into the same
 * `TCdsModelEntity[]` shape `parseCdsEntities` derives from `.cds` text, so `diffCdsEntities` can
 * report entity/field changes for object types with NO generated `.cds` model at all — currently
 * only the F4 flow (see `deploy-model-job.ts`'s `isF4` branch: it archives `db/external/MDG_F4.csn`
 * verbatim and never runs `buildDbModelForNamespace`). Without this, F4's "Review changes" step had
 * only the raw line-level text diff to go on — misleading for this file in particular: a freshly
 * re-exported EDMX is often minified to one giant line while an earlier, differently-configured
 * export was pretty-printed, so the text diff shows "replace everything" even when, structurally,
 * only a handful of entities actually changed (confirmed against a real customer's F4 upload: the
 * line diff looked like a full rewrite while this parser showed 9 entities added, 0 removed, 3 with
 * field changes).
 *
 * Skips the bare namespace/service root definition (`kind: "service"`, no `elements`) and, within
 * each entity, splits `target`-bearing elements out as compositions/associations the same way
 * `parseCdsEntities` does — real F4 CSNs do carry a handful of these (e.g. `SearchHelp` ->
 * `SearchHelpField`), even though most F4 entities have none.
 */
export function parseCsnEntities(csn: TCsnContent, sourceFile: string): TCdsModelEntity[] {
  const entities: TCdsModelEntity[] = [];
  for (const [name, definition] of Object.entries(csn.definitions)) {
    if (!definition?.elements) continue;

    const fields: TCdsModelEntity["fields"] = [];
    const keyFields: string[] = [];
    const compositions: TCdsModelEntity["compositions"] = [];

    for (const [elementName, element] of Object.entries(definition.elements)) {
      if (element?.target) {
        compositions.push({ field: elementName, target: element.target, cardinality: element.cardinality?.max === "*" ? "many" : "one" });
        continue;
      }
      fields.push({ name: elementName, type: cdsTypeToDisplayString(element ?? {}) });
      if (element?.key) keyFields.push(elementName);
    }

    entities.push({ name, sourceFile, keyFields, fields, compositions });
  }
  return entities;
}

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
 * freshly-generated content against a repo's current default branch). No-ops for a non-`.cds`/`.csn`
 * path or `undefined` content (the file doesn't exist on this side — e.g. a brand new file being
 * created).
 *
 * `includeCsn` is opt-in (default `false`) and deliberately NOT just "always look at `.csn` files
 * too": every normal object type's `srv/external/<Name>.csn` is the raw, EDMX-derived CSN — its
 * definitions are keyed by TECHNICAL name (`MDG_BP.AddressFaxNumberType`), while the generated
 * `db/final/*.cds` this function already parses for that same object type uses the BUSINESS-label
 * name (`entity AddressFaxNumber`). Turning this on unconditionally would make every ordinary deploy's
 * report double-count the same change under two unrelated names. It's safe (and needed) only for a
 * flow with no generated `.cds` at all to conflict with — today, only F4's `db/external/MDG_F4.csn`
 * (see `deploy-model-job.ts`'s `isF4` branch, which never runs `buildDbModelForNamespace`) — so
 * callers pass `true` only there.
 */
export function accumulateCdsEntities(target: TCdsModelEntity[], filePath: string, content: string | undefined, includeCsn = false): void {
  if (!content) return;
  if (CDS_FILE.test(filePath)) {
    target.push(...parseCdsEntities(content, filePath));
    return;
  }
  if (includeCsn && CSN_FILE.test(filePath)) {
    try {
      target.push(...parseCsnEntities(JSON.parse(content) as TCsnContent, filePath));
    } catch {
      // Malformed/partial CSN shouldn't happen for real `cds import` output — skip rather than throw,
      // matching this function's existing "no-op for content we can't structurally read" contract.
    }
  }
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
