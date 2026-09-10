import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { fetchArchivedCsn } from "./cds-dk-version-resolver";
import { deriveShortCodeFromRepos } from "./object-type-discovery";
import type { TObjectTypeRepoRef } from "./object-type-discovery";
import { findRootModel } from "./csn-model-builder";
import type { TCsnContent, TCsnDefinition, TCsnElement, TCsnOnToken } from "./csn-model-types";

/**
 * Lets Tool Studio's Deploy Model UI author a full object-type model — root entity down through
 * every composition level, any cardinality — without an EDMX at all, for object types that no
 * longer have one to upload (see `deploy-model-job.ts`'s `saveManualCsnAsUpload`/
 * `resolveManualUpload`, which slot the CSN this module builds into the exact same
 * upload-id → preview → deploy pipeline the EDMX path already uses).
 *
 * Deliberately produces/consumes plain `TCsnContent` — the same shape `cds import` produces — so
 * `buildDbModelForNamespace` (staging generation, i18n, multi-ERP mapping tables, `joinRisks`, all
 * of it) runs completely unmodified regardless of whether the CSN came from an EDMX or this editor.
 * Unlike `custom-model-editor.ts` (a narrower "attach one extra entity" escape hatch with its own
 * hand-rolled, simplified CDS renderer), this module never renders CDS text itself.
 */

const RELATION_PREFIX = "to_";

export type TManualDraftField = { name: string; type: string; isKey: boolean; i18nLabel?: string };
export type TManualDraftJoinPair = { parentField: string; childField: string };
export type TManualDraftRelation = { name: string; targetEntityId: string; cardinality: "one" | "many"; joinPairs: TManualDraftJoinPair[] };
export type TManualDraftEntity = { id: string; label: string; fields: TManualDraftField[]; relations: TManualDraftRelation[] };
export type TManualModelDraft = { rootEntityId: string; entities: TManualDraftEntity[] };

export type TManualModelView = {
  /** e.g. `MDG_DEA` — every entity this editor creates is keyed `<namespacePrefix>.<TechnicalName>`. */
  namespacePrefix: string;
  /** `false` when nothing has ever been archived for this object type yet — the draft is a fresh, single-root-entity tree instead of a parsed one. */
  hasExistingModel: boolean;
  archivePath: string;
  draft: TManualModelDraft;
};

// --- field type <-> CSN element (mirrors `buildTypeByFieldConfig`'s inverse in csn-model-builder.ts) ---

const FIELD_TYPE_PATTERN = /^(\w+)(?:\((\d+)(?:\s*,\s*(\d+))?\))?$/;

/** `"String(40)"` -> `{type:"cds.String", length:40}`, `"Decimal(15,2)"` -> precision/scale, `"Boolean"` -> bare type. */
export function parseCdsTypeString(typeString: string): Pick<TCsnElement, "type" | "length" | "precision" | "scale"> {
  const match = typeString.trim().match(FIELD_TYPE_PATTERN);
  if (!match) return { type: `cds.${typeString.trim()}` };
  const [, baseType, first, second] = match;
  if (baseType === "Decimal" && first) return { type: "cds.Decimal", precision: Number(first), scale: Number(second ?? 0) };
  if (first) return { type: `cds.${baseType}`, length: Number(first) };
  return { type: `cds.${baseType}` };
}

/** Inverse of `parseCdsTypeString` — used when loading an already-archived CSN into the editor for the first time. */
export function cdsTypeToDisplayString(element: Pick<TCsnElement, "type" | "length" | "precision" | "scale">): string {
  // A raw CSN type can carry a trailing `default ...` clause (e.g. multi_erp_central's synthetic
  // system keys) that isn't part of the base type name — strip it rather than surface it verbatim.
  const typeName = (element.type ?? "").replace(/^cds\./, "").split(" ")[0];
  if (typeName === "Decimal") return `Decimal(${element.precision ?? 0},${element.scale ?? 0})`;
  if (element.length) return `${typeName}(${element.length})`;
  return typeName;
}

// --- entity id minting ------------------------------------------------------

/** `"Drug Enforcement Record"` -> `"DrugEnforcementRecord"` — CSN definition names/technical suffixes can't contain spaces or punctuation. */
export function sanitizeLabelToTechnicalName(label: string): string {
  return label.replace(/[^A-Za-z0-9]/g, "") || "Entity";
}

/** `("MDG_DEA", "Item", {...})` -> `"MDG_DEA.Item"`, de-duplicated against `existingIds` (`Item2`, `Item3`, ...) if the sanitized label collides. */
export function mintEntityId(namespacePrefix: string, label: string, existingIds: ReadonlySet<string>): string {
  const base = sanitizeLabelToTechnicalName(label);
  let candidate = `${namespacePrefix}.${base}`;
  for (let suffix = 2; existingIds.has(candidate); suffix += 1) {
    candidate = `${namespacePrefix}.${base}${suffix}`;
  }
  return candidate;
}

/**
 * Every real MDG object always carries `objectID` as its universal identity key (confirmed by
 * `csn-model-builder.ts`'s `DB_NAMESPACE_CONFIG.final.identityKeys` — `buildDefaultRelationJoins`
 * unconditionally joins every composition on it, regardless of what's actually declared in the
 * CSN) — a manually-authored entity that lacks it would generate CDS referencing a field that does
 * not exist on either side of the join. Seeded here and treated as non-removable by the editor UI.
 */
export function createEmptyDraftEntity(id: string, label: string): TManualDraftEntity {
  return { id, label, fields: [{ name: "objectID", type: "String(10)", isKey: true }], relations: [] };
}

// --- draft <-> CSN -----------------------------------------------------------

/**
 * `objectID` is always joined automatically (see `createEmptyDraftEntity`'s doc comment) — join
 * pairs here are only the EXTRA key fields a composition needs beyond that (e.g. a real customer's
 * multi-key `CustomerMaterialInfoRecord` -> `CustomerMaterialInfoRecordItem` join on `customer` +
 * `distributionChannel` + `salesOrganization`, on top of the automatic `objectID` match — see the
 * fixture in `csn-model-builder.test.ts`). The common case (nothing beyond objectID) is `[]`.
 */
export function buildOnTokensFromJoinPairs(relationName: string, joinPairs: TManualDraftJoinPair[]): TCsnOnToken[] {
  const tokens: TCsnOnToken[] = [];
  joinPairs.forEach((pair, index) => {
    if (index > 0) tokens.push("and");
    tokens.push({ ref: [relationName, pair.childField] }, "=", { ref: [pair.parentField] });
  });
  return tokens;
}

/** Inverse of `buildOnTokensFromJoinPairs` — best-effort: an EDMX-derived CSN with no `<ReferentialConstraint>` (`on` missing/empty) just yields `[]`, same as a fresh manual composition with nothing beyond the automatic objectID join. */
export function parseJoinPairsFromOnTokens(tokens: TCsnOnToken[] | undefined): TManualDraftJoinPair[] {
  if (!tokens?.length) return [];
  const pairs: TManualDraftJoinPair[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (typeof token !== "object" || !Array.isArray(token.ref) || token.ref.length !== 2) continue;
    const equals = tokens[i + 1];
    const parentRef = tokens[i + 2];
    if (equals !== "=" || typeof parentRef !== "object" || !Array.isArray(parentRef.ref) || parentRef.ref.length !== 1) continue;
    pairs.push({ childField: token.ref[1], parentField: parentRef.ref[0] });
    i += 2;
  }
  return pairs;
}

/** Root entity's label is always forced to `objectType` — `buildDbModelForNamespace` hard-requires `rootDefinition["@sap.label"] === objectType`, so this can never drift out of sync with whatever the UI happened to send. */
export function draftToCsn(draft: TManualModelDraft, objectType: string): TCsnContent {
  const definitions: Record<string, TCsnDefinition> = {};

  for (const entity of draft.entities) {
    const elements: Record<string, TCsnElement> = {};

    for (const field of entity.fields) {
      elements[field.name] = { ...parseCdsTypeString(field.type), key: field.isKey || undefined, "@sap.label": field.i18nLabel };
    }
    for (const relation of entity.relations) {
      elements[relation.name] = {
        type: "cds.Composition",
        target: relation.targetEntityId,
        cardinality: { max: relation.cardinality === "many" ? "*" : "1" },
        on: buildOnTokensFromJoinPairs(relation.name, relation.joinPairs),
      };
    }

    definitions[entity.id] = { "@sap.label": entity.id === draft.rootEntityId ? objectType : entity.label, elements };
  }

  return { definitions };
}

function extractFields(elements: Record<string, TCsnElement>): TManualDraftField[] {
  return Object.entries(elements)
    .filter(([name, element]) => !name.startsWith(RELATION_PREFIX) && !element?.target)
    .map(([name, element]) => ({ name, type: cdsTypeToDisplayString(element), isKey: Boolean(element.key), i18nLabel: element["@sap.label"] }));
}

function extractRelations(elements: Record<string, TCsnElement>, csn: TCsnContent): TManualDraftRelation[] {
  const relations: TManualDraftRelation[] = [];
  for (const [name, element] of Object.entries(elements)) {
    if (!name.startsWith(RELATION_PREFIX) || !element?.target || !csn.definitions[element.target]) continue;
    relations.push({
      name,
      targetEntityId: element.target,
      cardinality: element.cardinality?.max === "*" ? "many" : "one",
      joinPairs: parseJoinPairsFromOnTokens(element.on),
    });
  }
  return relations;
}

/**
 * Flattens a CSN's composition tree (starting at `rootModelName`) into an editable draft —
 * mirrors `csn-model-builder.ts`'s `buildCsnWithLevel` traversal, but purely structural (no CDS
 * rendering, no error/joinRisk collection — that stays owned by `buildDbModelForNamespace` itself,
 * run separately at Validate time against whatever the user edits the draft into). A `visited`
 * guard stands in for that function's full ancestor-chain cycle check, which isn't needed here
 * since this is a display-only walk, not the authoritative validator.
 */
export function csnToDraft(csn: TCsnContent, rootModelName: string): TManualModelDraft {
  const entities: TManualDraftEntity[] = [];
  const visited = new Set<string>();

  const walk = (modelName: string): void => {
    if (visited.has(modelName)) return;
    visited.add(modelName);
    const definition = csn.definitions[modelName];
    if (!definition?.elements) return;

    entities.push({
      id: modelName,
      label: definition["@sap.label"] ?? modelName,
      fields: extractFields(definition.elements),
      relations: extractRelations(definition.elements, csn),
    });

    for (const [name, element] of Object.entries(definition.elements)) {
      if (name.startsWith(RELATION_PREFIX) && element?.target && csn.definitions[element.target]) walk(element.target);
    }
  };

  walk(rootModelName);
  return { rootEntityId: rootModelName, entities };
}

/**
 * Resolves the object type's archive path the same way `prepareDeployArtifacts` does (`db/external`
 * for F4, `srv/external` otherwise), loads whatever CSN is currently archived there, and returns it
 * as an editable draft — or a fresh single-root-entity draft when nothing has been archived yet
 * (a genuinely new, EDMX-less object type).
 */
export async function loadManualModelView(auth: TGitLabAuth, repos: TObjectTypeRepoRef[], objectType: string, objectTypeSlug: string): Promise<TManualModelView> {
  const isF4 = objectTypeSlug === "f4";
  const shortCode = deriveShortCodeFromRepos(repos);
  if (!shortCode) throw new Error("Could not derive this object type's short code from its repo names (expected simplemdg_db_<code>/simplemdg_srv_<code>) — cannot determine the model's namespace.");
  const namespacePrefix = `MDG_${shortCode.toUpperCase()}`;

  const archiveRepo = (isF4 ? repos.find((repo) => repo.role === "db") : repos.find((repo) => repo.role === "srv")) ?? repos.find((repo) => repo.role === "db");
  if (!archiveRepo) throw new Error(`No ${isF4 ? "db" : "srv"} repo found for this object type.`);
  const archivePath = `${isF4 ? "db" : "srv"}/external/${namespacePrefix}.csn`;

  const csn = await fetchArchivedCsn(auth, archiveRepo.projectId, archiveRepo.defaultBranch, archivePath);
  if (!csn) {
    const rootEntityId = mintEntityId(namespacePrefix, objectType, new Set());
    return { namespacePrefix, hasExistingModel: false, archivePath, draft: { rootEntityId, entities: [createEmptyDraftEntity(rootEntityId, objectType)] } };
  }

  const { rootModelName } = findRootModel(csn, objectType);
  return { namespacePrefix, hasExistingModel: true, archivePath, draft: csnToDraft(csn, rootModelName) };
}
