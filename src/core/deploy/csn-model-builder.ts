import type { TGitLabCommitAction } from "../gitlab/gitlab-write-client";
import type { TObjectTypeMode } from "./deploy-target-store";
import { DB_NAMESPACE_CONFIG, STAGING_BASE_ASPECT, STAGING_MAPPING_ASPECT } from "./csn-model-types";
import type { TCsnContent, TCsnElement, TCsnOnRef, TCsnOnToken, TDbNamespace } from "./csn-model-types";

const RELATION_PREFIX = "to_";
const MAX_LABEL_LENGTH = 31;
const FIRST_LEVEL = 1;

/**
 * Minimal brace-depth indenter (4 spaces/level) for the CDS text this module generates. Not a
 * general CDS formatter (legacy used `@sap/cds-lsp`'s internal `CdsPrettyPrint.beautify` — an
 * undocumented, SAP-internal API whose exports changed incompatibly between the version legacy
 * pinned, 5.5.7, and anything currently on npm, so depending on it directly isn't viable) — just
 * enough structure-aware indentation to avoid emitting flat, unindented CDS. Confirmed against a
 * real MR diff: without this, every single line reads as "changed" purely because of missing
 * indentation, even where the actual content is identical, making the diff unreviewable.
 */
function formatCdsText(lines: string[]): string {
  const output: string[] = [];
  let depth = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      output.push("");
      continue;
    }
    if (line.startsWith("}")) depth = Math.max(0, depth - 1);
    output.push("    ".repeat(depth) + line);
    if (line.endsWith("{")) depth += 1;
  }
  return output.join("\n");
}

/** Ported verbatim from `OTCSNHelper`'s `ErrorModelType` enum — these string values ARE the `[topic]` headers in the aggregated error message. */
const ERROR_TOPIC = {
  MODEL_LABEL_MISS: "Model: @sap.label |  Missing @sap.label",
  MODEL_LABEL_FORMAT: "Model: @sap.label |  @sap.label cannot contain SPACES",
  MODEL_LABEL_LENGTH: "Model: @sap.label |  Maximum is 31 characters",
  MODEL_LABEL_DUPLICATE: "Model: @sap.label |  Duplicated @sap.label. Must be unique",
  RELATION_NAME_DUPLICATION: "Relation: Relation name|  Duplicated RELATION name. Must be unique",
  FIELD_FORMAT: "Field: Element name must be camelCase",
  COMPOSITION_CONFLICT_LEVEL: "Conflict composition: In a level has B -> D and C -> D. A child with only one parent",
  COMPOSITION_CONFLICT_2LEVEL: "Conflict composition: In 2 level has A -> B and A -> C | B -> C. A child with only one parent",
} as const;

/**
 * Legacy hardcodes exactly one extra relation join (`BusinessPartner` → `to_Customer`/`to_Supplier`)
 * inline in an if-statement. Ported as an extensible lookup table instead — same output for the
 * BusinessPartner case, but a future customer-specific join can be added here without touching the
 * algorithm (per user's "fix obvious issues while porting" direction).
 */
export const EXTRA_RELATION_JOINS: Record<string, Record<string, string>> = {
  BusinessPartner: {
    to_Customer: "customer",
    to_Supplier: "supplier",
  },
};

const MULTI_ERP_MODES: TObjectTypeMode[] = ["multiple_erp", "multiple_erp_central"];

function getOrdinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`;
}

const BASE_UNNECESSARY_FIELDS = ["action", "mdgMarkForChange", "actionMode", "activateID", "activateItemID", "mdgLogID", "crNumber", "crItem", "crNumberItem"];
const NATROL_BUMA_EXTRA_FIELDS = ["Action", "MDGMarkForChange", "ActionMode", "ActivateID", "ActivateItemID", "MDGLogID", "CRNumber", "CRItem"];

function getUnnecessaryFieldsByMode(mode: TObjectTypeMode): Set<string> {
  if (mode === "natrol_ecc" || mode === "buma") return new Set([...BASE_UNNECESSARY_FIELDS, ...NATROL_BUMA_EXTRA_FIELDS]);
  return new Set(BASE_UNNECESSARY_FIELDS);
}

/** `mdgAttachment*` fields are always `UUID`; otherwise CSN type name mapped per mode (Boolean default handling, Decimal precision/scale, multi-ERP's bare-type-no-length convention). */
function buildTypeByFieldConfig(businessField: string, fieldConfig: TCsnElement, mode: TObjectTypeMode): string {
  if (businessField.startsWith("mdgAttachment")) return "UUID";
  const typeName = (fieldConfig.type ?? "").replace("cds.", "");
  if (typeName === "Boolean") {
    const noDefaultModes: TObjectTypeMode[] = ["eventmesh", "eventmesh_v1.6+", "multiple_erp", "multiple_erp_central", "buma"];
    return noDefaultModes.includes(mode) ? "Boolean" : "Boolean default false";
  }
  if (typeName === "Decimal") return `Decimal(${fieldConfig.precision}, ${fieldConfig.scale})`;
  if (mode === "multiple_erp" || mode === "multiple_erp_central") return typeName;
  return `${typeName}${fieldConfig.length ? `(${fieldConfig.length})` : ""}`;
}

function determineTableCompositionType(mode: TObjectTypeMode, cardinality?: { max?: string }): { compositionType: "Composition of one" | "Composition of many"; tableType: "single" | "repeat" } {
  if (cardinality?.max === "*") return { compositionType: "Composition of many", tableType: "repeat" };
  return { compositionType: mode === "multiple_erp_central" ? "Composition of many" : "Composition of one", tableType: "single" };
}

function buildDefaultRelationJoins(identityKeys: string[], relationName: string): string[] {
  return identityKeys.map((key) => `${relationName}.${key} = $self.${key}`);
}

function buildExtraRelationJoins(mode: TObjectTypeMode, businessTable: string, relationName: string): string[] {
  if (!MULTI_ERP_MODES.includes(mode)) return [];
  const field = EXTRA_RELATION_JOINS[businessTable]?.[relationName];
  return field ? [`${relationName}.${field} = $self.${field}`] : [];
}

function isOnRef(token: TCsnOnToken): token is TCsnOnRef {
  return typeof token === "object" && Array.isArray((token as TCsnOnRef).ref);
}

/** Translates the CSN composition's own `on` token array (`ref`/`"="`/`"and"`) into CDS text, appending each completed segment onto `relationStringList` (which already carries the namespace identity-key/extra/system-key joins) — mirrors legacy's inline accumulator exactly, including the unconditional final push. */
function appendOnTokensAsRelationSegments(tokens: TCsnOnToken[] | undefined, relationStringList: string[]): void {
  let segment = "";
  for (const token of tokens ?? []) {
    if (!token) continue;
    if (token === "and") {
      relationStringList.push(segment);
      segment = "";
    } else if (token === "=") {
      segment += " = ";
    } else if (isOnRef(token) && token.ref.length) {
      segment += token.ref.length === 1 ? `$self.${token.ref[0]}` : `${token.ref[0]}.${token.ref[1]}`;
    }
  }
  relationStringList.push(segment);
}

/**
 * Fallback join-condition synthesis for compositions whose CSN element carries no `on` tokens at
 * all (`{ type: "cds.Composition", target, cardinality, keys: [] }`, no `on` array). Confirmed
 * against a real upload processed by this repo's installed `@sap/cds-dk` (9.9.2): unlike whatever
 * older CDS version the legacy tool was built against — which always emitted an explicit `on` token
 * array for a parent-key-matching composition — this version's EDMX importer leaves the join
 * condition out entirely whenever the source EDMX has no explicit `<ReferentialConstraint>`, even
 * for the common "child repeats parent's business keys" MDG pattern.
 *
 * Reconstructs the join by taking every KEY field on the parent and checking whether the target
 * entity has a field of the SAME NAME — key or not (verified against a real customer model: the
 * child entity often carries the parent's key values as plain, non-key fields, e.g.
 * `AdditionalCMIRItem.customer` is not itself a key, only `alternativeMatByCustomer` is — an
 * intersection restricted to the target's OWN keys would miss it entirely).
 *
 * Known limitation, not fixable by name-matching alone: when the parent and child use DIFFERENT
 * field names for the same join column (confirmed on a real deeper relation:
 * `CMIRItemClassification.objectClass` joins `Characteristics.indicatorObj`, and `.counter` joins
 * `.intCounter`), no naming heuristic can discover the mapping — that information only exists in the
 * original EDMX's `<ReferentialConstraint>` elements, which `cds import` isn't surfacing into the
 * CSN here. Those relations still get skipped, same as when there's no overlap at all; the affected
 * sub-table's `db/final` content simply won't be regenerated by this pass (left as whatever's
 * already committed) until a real fix (parsing referential constraints from the raw EDMX) lands.
 */
function deriveJoinKeysFromKeyIntersection(csnContent: TCsnContent, parentElements: Record<string, TCsnElement>, targetModelName: string, relationName: string): string[] {
  const parentKeyNames = Object.keys(parentElements).filter((name) => parentElements[name]?.key);
  const targetElements = csnContent.definitions[targetModelName]?.elements ?? {};
  return parentKeyNames.filter((name) => Boolean(targetElements[name])).map((name) => `${relationName}.${name} = $self.${name}`);
}

function validateSapLabel(modelName: string, businessTable: string | undefined, errorModel: Record<string, string[]>): void {
  const pushError = (topic: string, message: string) => {
    (errorModel[topic] ??= []).push(message);
  };
  if (!businessTable) {
    pushError(ERROR_TOPIC.MODEL_LABEL_MISS, modelName);
    return;
  }
  if (businessTable.includes(" ")) pushError(ERROR_TOPIC.MODEL_LABEL_FORMAT, `Model name '${modelName}' - @sap.label '${businessTable}'`);
  if (businessTable.length > MAX_LABEL_LENGTH) pushError(ERROR_TOPIC.MODEL_LABEL_LENGTH, `Model name '${modelName}' - @sap.label '${businessTable}'`);
}

type TLevelBucket = {
  final: string[];
  staging: string[];
  /** Full CSN model names (not business-table labels) of every `to_X` target discovered at this level. */
  children: string[];
  businessTables: string[];
  i18n: string[];
};

type TWalkContext = {
  mode: TObjectTypeMode;
  csnContent: TCsnContent;
  namespaceKey: TDbNamespace;
  unnecessaryFields: Set<string>;
  modelNameToBusinessTable: Record<string, string>;
  businessTableToModelName: Record<string, string[]>;
  businessTableToChildren: Record<string, { level: number; children: string[] }>;
  relationNameToModelName: Record<string, string[]>;
  businessTableToTableType: Record<string, "single" | "repeat">;
  csnWithLevel: Record<number, TLevelBucket>;
  errorModel: Record<string, string[]>;
  objectType: string;
};

function getOrCreateLevelBucket(ctx: TWalkContext, level: number): TLevelBucket {
  return (ctx.csnWithLevel[level] ??= { final: [], staging: [], children: [], businessTables: [], i18n: [] });
}

/**
 * Recursive composition-tree walk — ported from `OTCSNHelper.buildCSNWithLevel`. Depth-first;
 * "level" = composition-tree depth from the root object type (root = 1), not CSN nesting depth.
 * Mutates `ctx` in place (matches legacy's accumulator style) — does not itself throw on validation
 * issues, only records them into `ctx.errorModel` for the caller to check once the whole tree has
 * been walked (see `buildDbModelForNamespace`'s fail-fast check).
 */
function buildCsnWithLevel(ctx: TWalkContext, modelName: string, currentLevel: number, parentModelName: string | null, parentChain: string[]): void {
  if (!modelName || currentLevel < 1) return;

  const currentModelInfo = ctx.csnContent.definitions[modelName];
  if (!currentModelInfo?.elements || Object.keys(currentModelInfo.elements).length === 0) return;
  // Bound to a local so it stays narrowed to `Record<string, TCsnElement>` (a property access like
  // `currentModelInfo.elements` re-widens to `| undefined` after any intervening function call).
  const elements = currentModelInfo.elements;

  const businessTable = currentModelInfo["@sap.label"];
  validateSapLabel(modelName, businessTable, ctx.errorModel);
  (ctx.businessTableToModelName[businessTable ?? ""] ??= []).push(modelName);
  if (!businessTable) return;

  const level = getOrCreateLevelBucket(ctx, currentLevel);
  const namespace = DB_NAMESPACE_CONFIG[ctx.namespaceKey];

  const mappingFinalForTable: string[] = [];
  const mappingStagingForTable: string[] = [];

  level.final.push(`@(title : '{i18n>${businessTable}}')`);
  if (ctx.mode === "multiple_erp_central") {
    level.final.push(`@(tabletype: '${ctx.businessTableToTableType[businessTable] ?? "single"}')`);
  }
  level.final.push(`entity ${businessTable} : ${currentLevel === FIRST_LEVEL ? namespace.firstLevelEntity : namespace.childLevelEntity} {`);

  level.staging.push(`@(title : '{i18n>${businessTable}}')`, `entity ${businessTable} : final_${businessTable}, ${STAGING_BASE_ASPECT} {`);

  if (MULTI_ERP_MODES.includes(ctx.mode)) {
    mappingFinalForTable.push(`entity ${businessTable}Mapping : ${namespace.mappingEntity} {`, `key ERPSystem : String;`);
    mappingStagingForTable.push(`entity ${businessTable}Mapping : final_${businessTable}Mapping, ${STAGING_MAPPING_ASPECT} {`);
  }

  const children: string[] = [];
  const businessChildren: string[] = [];
  level.i18n.push(`${businessTable}=${businessTable}`);

  const keyList: string[] = [];
  const systemKeyList: string[] = [];
  let propertyNameList = Object.keys(elements);
  const newSystemFieldList: string[] = [];

  if (ctx.mode === "multiple_erp_central" && currentLevel > 1) {
    if (currentLevel > 2 && parentChain.length) parentChain.forEach((parent) => newSystemFieldList.push(`targetSystem${parent}`));
    newSystemFieldList.push(`targetSystem${businessTable}`);

    newSystemFieldList.forEach((fieldName) => {
      if (elements[fieldName]) return;
      elements[fieldName] = { key: true, type: "cds.String default 'CENTRAL'", notNull: true, isSystemKey: true };
      systemKeyList.push(fieldName);
    });

    propertyNameList = [...newSystemFieldList, ...propertyNameList];
  }

  for (const propertyName of propertyNameList) {
    if (ctx.unnecessaryFields.has(propertyName)) continue;
    const fieldConfig = elements[propertyName];
    if (!fieldConfig) continue;

    if (propertyName.startsWith(RELATION_PREFIX)) {
      const { type, target, cardinality, on } = fieldConfig;
      if (!type || !target) continue;
      if (target === parentModelName) continue;

      const hasOnTokens = Boolean(on?.length);
      const keyIntersectionJoins = hasOnTokens ? [] : deriveJoinKeysFromKeyIntersection(ctx.csnContent, elements, target, propertyName);
      // Nothing to join on at all (no `on` tokens AND no shared key fields with the target) — same
      // safety behavior as legacy: skip rather than emit a relation with no real join condition.
      if (!hasOnTokens && !keyIntersectionJoins.length) continue;

      const targetBusinessTable = ctx.modelNameToBusinessTable[target];
      children.push(target);

      const { compositionType, tableType } = determineTableCompositionType(ctx.mode, cardinality);
      businessChildren.push(targetBusinessTable);
      ctx.businessTableToTableType[targetBusinessTable] = tableType;

      const relationStringList = buildDefaultRelationJoins(namespace.identityKeys, propertyName);
      relationStringList.push(...buildExtraRelationJoins(ctx.mode, businessTable, propertyName));
      systemKeyList.forEach((systemKey) => relationStringList.push(`${propertyName}.${systemKey} = $self.${systemKey}`));
      if (hasOnTokens) {
        appendOnTokensAsRelationSegments(on, relationStringList);
      } else {
        relationStringList.push(...keyIntersectionJoins);
      }

      const header = `${propertyName} : ${compositionType} ${targetBusinessTable} on`;
      level.final.push(header, relationStringList.join(" and "), ";");

      const stagingRelationStringList = [...relationStringList];
      stagingRelationStringList.splice(1, 0, `${propertyName}.taskID = $self.taskID`);
      level.staging.push(header, stagingRelationStringList.join(" and "), ";");

      (ctx.relationNameToModelName[propertyName] ??= []).push(`${target} - ${targetBusinessTable}`);
      continue;
    }

    // Normal scalar field.
    if (ctx.mode !== "natrol_ecc" && ctx.mode !== "buma" && ctx.mode !== "SAP_SF") {
      if (propertyName[0] !== propertyName[0].toLowerCase()) {
        (ctx.errorModel[ERROR_TOPIC.FIELD_FORMAT] ??= []).push(`Level ${currentLevel}: Model name '${modelName}' - @sap.label '${businessTable}' - field '${propertyName}'`);
      }
    }

    const typeData = buildTypeByFieldConfig(propertyName, fieldConfig, ctx.mode);
    const defineFieldString = `${propertyName} : ${typeData} @(title : '{i18n>${businessTable}.${propertyName}}');`;
    const finalDefineFieldString = fieldConfig.key ? `key ${defineFieldString}` : defineFieldString;

    if (fieldConfig.key) keyList.push(propertyName);
    level.final.push(finalDefineFieldString);
    level.i18n.push(`${businessTable}.${propertyName}=${fieldConfig["@sap.label"] ?? startCase(propertyName)}`);

    if (MULTI_ERP_MODES.includes(ctx.mode)) {
      if (fieldConfig.key) mappingFinalForTable.push(finalDefineFieldString);
      if (!fieldConfig.isSystemKey) mappingFinalForTable.push(`ERP${defineFieldString}`);
    }
  }

  newSystemFieldList.forEach((fieldName) => delete elements[fieldName]);
  level.i18n.push("");

  if (MULTI_ERP_MODES.includes(ctx.mode) && keyList.length) {
    const foreignRelationText = keyList.map((keyName) => `to_${businessTable}Mapping.${keyName} = $self.${keyName}`).join(" and ");
    const defaultMappingJoins = buildDefaultRelationJoins(namespace.identityKeys, `to_${businessTable}Mapping`).join(" and ");

    level.final.push(`to_${businessTable}Mapping : Composition of many ${businessTable}Mapping on ${defaultMappingJoins}  and `, `${foreignRelationText};`);
    level.staging.push(
      `to_${businessTable}Mapping : Composition of many ${businessTable}Mapping on to_${businessTable}Mapping.objectID = $self.objectID and to_${businessTable}Mapping.taskID = $self.taskID and`,
      `${foreignRelationText};`,
    );
  }

  level.final.push("}");
  level.staging.push("}");

  if (MULTI_ERP_MODES.includes(ctx.mode)) {
    mappingFinalForTable.push("}");
    mappingStagingForTable.push("}");
    level.final.push(...mappingFinalForTable);
    level.staging.push(...mappingStagingForTable);
  }

  level.businessTables.push(businessTable);
  level.children.push(...children);
  ctx.businessTableToChildren[businessTable] = { level: currentLevel, children: [...new Set(businessChildren)] };

  for (const child of children) {
    const newParentChain = currentLevel > 1 ? [...parentChain, businessTable] : [];
    buildCsnWithLevel(ctx, child, currentLevel + 1, modelName, newParentChain);
  }
}

/** `startCase("someField")` → `"Some Field"` — the i18n label fallback when a field has no `@sap.label`. No lodash in this repo, so ported as a small local helper. */
function startCase(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export type TDbModelNamespaceResult = {
  dbActions: TGitLabCommitAction[];
  srvActions: TGitLabCommitAction[];
  i18nFragments: string[];
};

/**
 * One full `readCSNToFinalDB` pass — generates `db/<namespace-folder>/<ordinal>-model.cds` (+
 * `db/staging/<ordinal>-model.cds` and `srv/master-data-service.cds` for the `final` namespace
 * only) for every level of the object type's composition tree.
 *
 * Fail-fast (bug fix vs. legacy): validates the ENTIRE tree first — no `CommitAction`s are built
 * until every error topic (`@sap.label` issues, duplicate labels/relation names, composition
 * conflicts) has been checked. Legacy instead threw only after rendering CDS text, so a rejected
 * upload could still leak partial output.
 */
export function buildDbModelForNamespace(namespaceKey: TDbNamespace, csnContent: TCsnContent, rootModelName: string, objectType: string, shortName: string, mode: TObjectTypeMode): TDbModelNamespaceResult {
  const namespace = DB_NAMESPACE_CONFIG[namespaceKey];
  const shortNameLowercase = shortName.toLowerCase();
  const finalPrefix = `${shortNameLowercase}${namespace.suffix}`;
  const stagingPrefix = `${shortNameLowercase}.model.staging`;

  const rootDefinition = csnContent.definitions[rootModelName];
  if (!rootDefinition) throw new Error(`Error! Cannot read ROOT table. Missing table ${rootModelName} (element name)`);
  if (rootDefinition["@sap.label"] !== objectType) throw new Error(`Error! Cannot read ROOT table. @sap.label !== ${objectType}`);

  const modelNameToBusinessTable: Record<string, string> = {};
  for (const [modelName, definition] of Object.entries(csnContent.definitions)) {
    const businessTable = definition?.["@sap.label"];
    if (businessTable) modelNameToBusinessTable[modelName] = businessTable;
  }

  const ctx: TWalkContext = {
    mode,
    csnContent,
    namespaceKey,
    unnecessaryFields: getUnnecessaryFieldsByMode(mode),
    modelNameToBusinessTable,
    businessTableToModelName: {},
    businessTableToChildren: {},
    relationNameToModelName: {},
    businessTableToTableType: {},
    csnWithLevel: {},
    errorModel: {},
    objectType,
  };

  buildCsnWithLevel(ctx, rootModelName, 1, null, []);

  for (const [businessTable, modelNames] of Object.entries(ctx.businessTableToModelName)) {
    if (modelNames.length <= 1) continue;
    (ctx.errorModel[ERROR_TOPIC.MODEL_LABEL_DUPLICATE] ??= []).push(`@sap.label: ${businessTable} -> ${modelNames}`);
  }
  for (const [relationName, modelNames] of Object.entries(ctx.relationNameToModelName)) {
    if (modelNames.length <= 1) continue;
    (ctx.errorModel[ERROR_TOPIC.RELATION_NAME_DUPLICATION] ??= []).push(`Relation name: '${relationName}' | Model name - @sap.label: ${modelNames} `);
  }

  // Composition-conflict validation needs the fully-populated tree, but doesn't need to render any
  // CDS text — run it standalone so the fail-fast check below covers it too.
  for (const [level, bucket] of Object.entries(ctx.csnWithLevel)) {
    if (!bucket.children.length) continue;
    const businessTableChildren = bucket.children.map((child) => ctx.modelNameToBusinessTable[child]);
    const duplicates = [...new Set(businessTableChildren.filter((table, index) => businessTableChildren.indexOf(table) !== index))];
    if (duplicates.length) {
      (ctx.errorModel[ERROR_TOPIC.COMPOSITION_CONFLICT_LEVEL] ??= []).push(`Level ${level}: @sap.label: '${duplicates}'`);
    }

    const conflictChildBusinessTables = bucket.businessTables.filter((table) => businessTableChildren.includes(table));
    if (conflictChildBusinessTables.length) {
      const conflictSources = Object.entries(ctx.businessTableToChildren)
        .filter(([, info]) => info.children.some((child) => conflictChildBusinessTables.includes(child)))
        .map(([table, info]) => `level ${info.level} - ${table}`);
      (ctx.errorModel[ERROR_TOPIC.COMPOSITION_CONFLICT_2LEVEL] ??= []).push(`Level ${Number(level) - 1} vs ${level}: @sap.label '${conflictSources}' - Children '${conflictChildBusinessTables}'`);
    }
  }

  if (Object.keys(ctx.errorModel).length > 0) {
    const lines: string[] = [];
    for (const [topic, messages] of Object.entries(ctx.errorModel)) {
      lines.push(`[${topic}]`);
      messages.forEach((message) => lines.push(`* ${message}`));
      lines.push("");
    }
    throw new Error(lines.join("\n"));
  }

  // --- Render: build db/<namespace>/<ordinal>-model.cds (+ staging, + master-data-service for `final`) ---
  const dbActions: TGitLabCommitAction[] = [];
  const srvActions: TGitLabCommitAction[] = [];
  const i18nFragments: string[] = [];
  const importMasterDataList: string[] = [];
  const exportMasterDataList: string[] = [];

  const sortedLevels = Object.keys(ctx.csnWithLevel)
    .map(Number)
    .sort((a, b) => a - b);

  for (const level of sortedLevels) {
    const bucket = ctx.csnWithLevel[level];
    i18nFragments.push(...bucket.i18n);

    const currentOrdinal = getOrdinal(level);
    const nextOrdinal = getOrdinal(level + 1);
    const currentFileName = `${currentOrdinal}-model.cds`;
    const masterDataHashtag = `${shortNameLowercase}_${currentOrdinal}`;

    if (MULTI_ERP_MODES.includes(mode)) {
      importMasterDataList.push(`using ${shortNameLowercase}.model.final as ${masterDataHashtag} from '@simplemdg/db_${shortNameLowercase}/db/final/${currentOrdinal}-model';`);
    }

    const finalLines = [`namespace ${finalPrefix};`];
    const stagingLines = [`namespace ${stagingPrefix};`];

    const finalTableImports: string[] = [];
    bucket.businessTables.forEach((table) => {
      finalTableImports.push(`${finalPrefix}.${table} as final_${table}`);
      if (MULTI_ERP_MODES.includes(mode)) {
        finalTableImports.push(`${finalPrefix}.${table}Mapping as final_${table}Mapping`);
        exportMasterDataList.push(`entity ${table}  as projection on ${masterDataHashtag}.${table};`);
        exportMasterDataList.push(`entity ${table}Mapping  as projection on ${masterDataHashtag}.${table}Mapping;`);
      }
    });
    stagingLines.push("using {", finalTableImports.join(","), `} from '../final/${currentFileName}';`);

    if (bucket.children.length) {
      const businessTableChildren = bucket.children.map((child) => ctx.modelNameToBusinessTable[child]);
      finalLines.push("using {", businessTableChildren.map((table) => `${finalPrefix}.${table}`).join(","), `} from './${nextOrdinal}-model';`);
      stagingLines.push("using {", businessTableChildren.map((table) => `${stagingPrefix}.${table}`).join(","), `} from './${nextOrdinal}-model';`);
    }

    finalLines.push(`using core.common.${level === 1 ? namespace.firstLevelEntity : namespace.childLevelEntity} from '@simplemdg/db_common/db/common-model';`);
    if (MULTI_ERP_MODES.includes(mode)) finalLines.push(`using core.common.${namespace.mappingEntity} from '@simplemdg/db_common/db/common-model';`);
    stagingLines.push(`using core.common.${STAGING_BASE_ASPECT} from '@simplemdg/db_common/db/common-model';`);
    if (MULTI_ERP_MODES.includes(mode)) stagingLines.push(`using core.common.${STAGING_MAPPING_ASPECT} from '@simplemdg/db_common/db/common-model';`);

    finalLines.push(...bucket.final);
    stagingLines.push(...bucket.staging);

    dbActions.push({ action: "update", file_path: `db/${namespace.folder}/${currentFileName}`, content: formatCdsText(finalLines) });
    if (namespaceKey === "final") {
      dbActions.push({ action: "update", file_path: `db/staging/${currentFileName}`, content: formatCdsText(stagingLines) });
    }
  }

  if (namespaceKey === "final" && MULTI_ERP_MODES.includes(mode)) {
    const masterDataLines = [
      `namespace ${shortNameLowercase}.service.masterdata;`,
      "",
      ...importMasterDataList,
      "",
      `service ${objectType}MasterDataService @(requires: ['MD_${objectType}', 'system-user']) @(path: '/${objectType}MasterDataService') {`,
      ...exportMasterDataList,
      "}",
    ];
    srvActions.push({ action: "update", file_path: "srv/master-data-service.cds", content: formatCdsText(masterDataLines) });
  }

  return { dbActions, srvActions, i18nFragments };
}

/**
 * Finds the CSN's root object-type entity and derives `shortName` from it, instead of requiring an
 * operator-configured short code the way legacy did (`OBJECT_TYPE_DATA[shortName]`). Legacy's own
 * runtime invariant is that the root entity is always keyed `MDG_<ShortName>.<ObjectType>` — this
 * just reads that code back out of the CSN itself, which is more robust than guessing it from a
 * GitLab repo-naming convention and needs no new config.
 */
export function findRootModel(csnContent: TCsnContent, objectType: string): { rootModelName: string; shortName: string } {
  const entry = Object.entries(csnContent.definitions).find(([modelName, definition]) => definition?.["@sap.label"] === objectType && /^MDG_[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(modelName));
  if (!entry) {
    throw new Error(`Cannot find a root entity in the imported CSN with @sap.label === "${objectType}" (expected a definition named "MDG_<code>.${objectType}").`);
  }
  const [rootModelName] = entry;
  const shortName = rootModelName.split(".")[0].replace(/^MDG_/, "");
  return { rootModelName, shortName };
}
