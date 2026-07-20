import { findEntityBlocks, findRelationsInBody } from "./cds-entity-blocks";

/**
 * Read-only structural view of an already-committed `.cds` file — powers the Custom Model editor's
 * "current model" browser and its "attach to" picker, and supplies the parent entity's own key
 * fields so a new custom-entity composition's join condition can be built without guessing (unlike
 * `csn-model-builder.ts`, which has to reverse-engineer joins from EDMX with no `<ReferentialConstraint>`
 * — here the parent's `key` fields are already sitting in the committed CDS text).
 *
 * Works off CDS text, not CSN, so it can run for any object type right after selection — no EDMX
 * upload required.
 */

export type TCdsModelField = { name: string; type: string };
export type TCdsModelRelation = { field: string; target: string; cardinality: "one" | "many" };

export type TCdsModelEntity = {
  name: string;
  sourceFile: string;
  keyFields: string[];
  fields: TCdsModelField[];
  compositions: TCdsModelRelation[];
};

const FIELD_DECLARATION = /(key\s+)?(\w+)\s*:\s*([^;@]+?)(?:\s*@[^;]*)?;/g;

/** Parses every `entity ... { ... }` block in `fileContent` into a structural summary, tagging each with `sourceFile` (e.g. `db/final/1st-model.cds`) so callers know where to splice an edit back in. */
export function parseCdsEntities(fileContent: string, sourceFile: string): TCdsModelEntity[] {
  return findEntityBlocks(fileContent).map((block) => {
    const relations = findRelationsInBody(block.body);
    const relationFieldNames = new Set(relations.map((relation) => relation.field));

    const fields: TCdsModelField[] = [];
    const keyFields: string[] = [];
    const fieldRegex = new RegExp(FIELD_DECLARATION);
    let match: RegExpExecArray | null;
    while ((match = fieldRegex.exec(block.body))) {
      const [, keyPrefix, fieldName, typeRaw] = match;
      if (relationFieldNames.has(fieldName)) continue; // a composition/association, not a scalar field
      fields.push({ name: fieldName, type: typeRaw.trim() });
      if (keyPrefix) keyFields.push(fieldName);
    }

    return {
      name: block.name,
      sourceFile,
      keyFields,
      fields,
      compositions: relations.map((relation) => ({ field: relation.field, target: relation.target, cardinality: relation.cardinality })),
    };
  });
}
