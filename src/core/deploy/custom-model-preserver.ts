import { findEntityBlocks, findRelationsInBody } from "./cds-entity-blocks";

/**
 * Recovers a customer-authored `custom-model.cds` attachment from an already-committed
 * `db/<tier>/<ordinal>-model.cds` file, so `csn-model-builder.ts` can re-inject it into the
 * regenerated version of that same file instead of silently dropping it.
 *
 * Confirmed against a real customer repo (`simplemdg_db_prd`, GitLab MR !17): customers hand-add a
 * `custom-model.cds` per tier defining extra entities the SAP EDMX schema knows nothing about
 * (e.g. `ProductCustom`), then wire ONE composition into an existing generated entity:
 * ```
 * using {prd.model.final.ProductCustom} from './custom-model.cds';
 * entity Product : business_1st_level_entity {
 *   ...
 *   to_ProductCustom : Composition of one ProductCustom
 *       on to_ProductCustom.objectID = $self.objectID
 *       and to_ProductCustom.product  = $self.product;
 * }
 * ```
 * Since the uploaded EDMX never contains `ProductCustom` (it isn't part of the real SAP metadata),
 * `buildDbModelForNamespace`'s full regenerate of `db/final/1st-model.cds` has no way to know this
 * import + composition should still exist — this module is what lets it find out.
 */

export type TCustomModelAttachment = {
  /** The exact `using {...} from './custom-model(.cds)?';` line(s) this attachment depends on, verbatim. */
  importLines: string[];
  /** The exact composition/association field block (header through terminating `;`), one line per array entry. */
  compositionLines: string[];
};

export type TCustomModelPreservationForTier = {
  /** Keyed by the parent entity's business-table name (e.g. `Product`) — where the composition lives. */
  byParentEntity: Record<string, TCustomModelAttachment>;
};

/** Every entity name `custom-model.cds` itself defines (e.g. `{ "ProductCustom" }`) — these are the targets `extractCustomModelAttachments` looks for in the main model files. */
export function parseCustomModelEntityNames(customModelCdsContent: string): Set<string> {
  const names = new Set<string>();
  const regex = /entity\s+(\w+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(customModelCdsContent))) names.add(match[1]);
  return names;
}

const CUSTOM_MODEL_IMPORT_LINE = /using\s*\{[^}]*\}\s*from\s*'\.\/custom-model(?:\.cds)?'\s*;/g;

/** Does `importLine`'s brace list mention `entityName` (ignoring `as alias` and namespace prefixes)? Exported for reuse by `custom-model-editor.ts` (Part B), which needs the same check when unwiring an attachment's import line. */
export function importLineReferencesEntity(importLine: string, entityName: string): boolean {
  const braceMatch = importLine.match(/\{([^}]*)\}/);
  const namesPart = braceMatch ? braceMatch[1] : importLine;
  return namesPart
    .split(",")
    .map((identifier) => identifier.trim().split(/\s+as\s+/i)[0].trim())
    .some((identifier) => identifier.split(".").pop() === entityName);
}

/**
 * Scans one already-committed model file (e.g. `db/final/1st-model.cds`) for every
 * composition/association whose target is one of `customEntityNames`, and the `using ... from
 * './custom-model.cds'` import line(s) each one depends on — grouped by the parent entity so the
 * caller can re-inject them into the SAME entity block when that file gets regenerated, wherever
 * in the composition tree that parent now renders.
 */
export function extractCustomModelAttachments(existingModelFileContent: string, customEntityNames: Set<string>): TCustomModelPreservationForTier {
  if (!customEntityNames.size) return { byParentEntity: {} };

  const importLines = [...existingModelFileContent.matchAll(CUSTOM_MODEL_IMPORT_LINE)].map((match) => match[0].trim());
  const byParentEntity: Record<string, TCustomModelAttachment> = {};

  for (const block of findEntityBlocks(existingModelFileContent)) {
    for (const relation of findRelationsInBody(block.body)) {
      if (!customEntityNames.has(relation.target)) continue;

      const entry = (byParentEntity[block.name] ??= { importLines: [], compositionLines: [] });
      entry.compositionLines.push(
        ...relation.fullText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      );

      for (const importLine of importLines) {
        if (importLineReferencesEntity(importLine, relation.target) && !entry.importLines.includes(importLine)) {
          entry.importLines.push(importLine);
        }
      }
    }
  }

  return { byParentEntity };
}

/** Merges multiple per-ordinal-file extractions (e.g. across `1st-model.cds`, `2nd-model.cds`, ...) into one tier-wide map. */
export function mergeCustomModelPreservation(parts: TCustomModelPreservationForTier[]): TCustomModelPreservationForTier {
  const byParentEntity: Record<string, TCustomModelAttachment> = {};
  for (const part of parts) {
    for (const [parentEntity, attachment] of Object.entries(part.byParentEntity)) {
      const entry = (byParentEntity[parentEntity] ??= { importLines: [], compositionLines: [] });
      for (const line of attachment.importLines) if (!entry.importLines.includes(line)) entry.importLines.push(line);
      for (const line of attachment.compositionLines) if (!entry.compositionLines.includes(line)) entry.compositionLines.push(line);
    }
  }
  return { byParentEntity };
}
