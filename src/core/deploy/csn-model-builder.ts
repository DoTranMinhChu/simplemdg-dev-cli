import type { TGitLabCommitAction } from "../gitlab/gitlab-write-client";
import type { TObjectTypeMode } from "./deploy-target-store";
import { DB_NAMESPACE_CONFIG, STAGING_BASE_ASPECT, STAGING_MAPPING_ASPECT } from "./csn-model-types";
import type { TCsnContent, TCsnElement, TCsnOnRef, TCsnOnToken, TCustomModelPreservation, TCustomModelWarning, TDbNamespace, TEntityRenameRisk, TJoinFieldRisk } from "./csn-model-types";
import { formatCdsText } from "./cds-pretty-print";

const RELATION_PREFIX = "to_";
const MAX_LABEL_LENGTH = 31;
const FIRST_LEVEL = 1;

/**
 * Renders a composition's join clauses one-per-line (`on  <first>`, `and <rest>`, ...) instead of a
 * single `join(" and ")` line. Confirmed against a real MR diff: a flat one-line join, even when
 * semantically identical to what's already committed, reads as a fully-changed line and makes the
 * diff unreviewable — legacy's own generator always wrote one clause per line.
 */
function renderOnClauseLines(clauses: string[]): string[] {
  return clauses.map((clause, index) => (index === 0 ? `on  ${clause}` : `and ${clause}`));
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

/**
 * Field-name remaps for the key-intersection fallback (see `deriveJoinKeysFromKeyIntersection`),
 * for compositions whose source EDMX has no `<ReferentialConstraint>` AND whose parent/child use
 * DIFFERENT field names for the same join column — name-matching alone can't discover these.
 * Keyed by the CHILD's `@sap.label` business table (stable across re-uploads of the same object
 * type, unlike raw CSN definition names), then by the PARENT's key field name.
 *
 * Confirmed on a real customer model (CMIR): `CMIRItemClassification.objectClass` ("Ind.:
 * Object/Class") joins `Characteristics.indicatorObj` (same label, different name) — the naive
 * fallback dropped this join entirely, since no field literally named `objectClass` exists on
 * Characteristics. And `.counter` ("Int. counter") joins `Characteristics.intCounter` (same
 * label+length), NOT `Characteristics.counter` (a same-named but semantically different field,
 * "Characteristic value counter") — the naive fallback matched the wrong field because both
 * happened to share a literal name.
 */
export const KEY_INTERSECTION_FIELD_OVERRIDES: Record<string, Record<string, string>> = {
  Characteristics: {
    objectClass: "indicatorObj",
    counter: "intCounter",
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
 * Known limitation when the parent and child use DIFFERENT field names for the same join column
 * (confirmed on a real deeper relation: `CMIRItemClassification.objectClass` joins
 * `Characteristics.indicatorObj`, and `.counter` joins `.intCounter`): no general naming heuristic
 * can discover that mapping — that information only exists in the original EDMX's
 * `<ReferentialConstraint>` elements, which `cds import` isn't surfacing into the CSN here. Known
 * cases are recorded in `KEY_INTERSECTION_FIELD_OVERRIDES` (checked below) so they render a correct
 * join instead of a silently dropped/misjoined one; anything not in that table still gets skipped,
 * same as when there's no overlap at all, until it's identified and added.
 */
function deriveJoinKeysFromKeyIntersection(csnContent: TCsnContent, parentElements: Record<string, TCsnElement>, targetModelName: string, targetBusinessTable: string | undefined, relationName: string): string[] {
  const parentKeyNames = Object.keys(parentElements).filter((name) => parentElements[name]?.key);
  const targetElements = csnContent.definitions[targetModelName]?.elements ?? {};
  const overrides = (targetBusinessTable ? KEY_INTERSECTION_FIELD_OVERRIDES[targetBusinessTable] : undefined) ?? {};
  return parentKeyNames
    .map((name) => ({ name, childField: overrides[name] ?? name }))
    .filter(({ childField }) => Boolean(targetElements[childField]))
    .map(({ name, childField }) => `${relationName}.${childField} = $self.${name}`);
}

/**
 * Early-warning scan companion to `deriveJoinKeysFromKeyIntersection` — same inputs, but reports
 * *why* each parent key did or didn't produce a join clause instead of only returning the winners.
 * Runs for every composition missing an `on` array, independent of whether an override already
 * fixes it, so the preview surfaces both "still broken" and "silently auto-corrected" cases.
 *
 * The one heuristic beyond plain name-matching: comparing `@sap.label` (SAP's field label,
 * preserved by `cds import` from the EDMX's `sap:label` annotation) catches both failure shapes
 * seen on real data — a same-named field that means something else (`CMIRItemClassification.counter`
 * vs `Characteristics.counter`, same name, different label) and a differently-named field that's
 * actually the right one (`.objectClass` vs `.indicatorObj`, different name, identical label). It
 * cannot prove a mapping is correct, only flag disagreement for a human to check.
 */
function auditKeyIntersectionRisks(csnContent: TCsnContent, parentElements: Record<string, TCsnElement>, parentBusinessTable: string, targetModelName: string, targetBusinessTable: string | undefined, relationName: string): TJoinFieldRisk[] {
  if (!targetBusinessTable) return [];
  const parentKeyNames = Object.keys(parentElements).filter((name) => parentElements[name]?.key);
  const targetElements = csnContent.definitions[targetModelName]?.elements ?? {};
  const overrides = KEY_INTERSECTION_FIELD_OVERRIDES[targetBusinessTable] ?? {};
  const findings: TJoinFieldRisk[] = [];

  const findByLabel = (label: string | undefined): string | undefined => {
    if (!label) return undefined;
    return Object.entries(targetElements).find(([, element]) => element?.["@sap.label"] === label)?.[0];
  };

  for (const parentKeyField of parentKeyNames) {
    const parentLabel = parentElements[parentKeyField]?.["@sap.label"];
    const base = { relationName, parentBusinessTable, targetBusinessTable, parentKeyField };

    if (overrides[parentKeyField]) {
      const childField = overrides[parentKeyField];
      findings.push({
        ...base,
        severity: "info",
        outcome: "resolved-by-override",
        message: `No <ReferentialConstraint> for this relation; '${parentKeyField}' is mapped to '${targetBusinessTable}.${childField}' via KEY_INTERSECTION_FIELD_OVERRIDES.`,
      });
      continue;
    }

    if (targetElements[parentKeyField]) {
      const childLabel = targetElements[parentKeyField]?.["@sap.label"];
      if (parentLabel && childLabel && parentLabel !== childLabel) {
        findings.push({
          ...base,
          severity: "medium",
          outcome: "label-mismatch",
          message: `'${parentKeyField}' exists on both sides and was joined by name, but its label differs ('${parentLabel}' vs '${childLabel}') — verify these are really the same field, or add a KEY_INTERSECTION_FIELD_OVERRIDES entry if not.`,
        });
      }
      continue;
    }

    const suggestion = findByLabel(parentLabel);
    if (suggestion) {
      findings.push({
        ...base,
        severity: "high",
        outcome: "dropped-with-label-suggestion",
        message: `'${parentKeyField}' (label '${parentLabel}') has no same-named field on '${targetBusinessTable}' and is currently DROPPED from the join, but '${targetBusinessTable}.${suggestion}' shares the same label — likely the real match. Add KEY_INTERSECTION_FIELD_OVERRIDES.${targetBusinessTable}.${parentKeyField} = '${suggestion}'.`,
      });
    } else {
      findings.push({
        ...base,
        severity: "critical",
        outcome: "dropped-no-suggestion",
        message: `'${parentKeyField}' has no matching field (by name or label) on '${targetBusinessTable}' — this join condition is DROPPED. The source EDMX likely lacks a <ReferentialConstraint> for this relation; verify the correct join manually.`,
      });
    }
  }

  return findings;
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
  /** `using ... from './custom-model.cds'` line(s) needed by any preserved custom-model.cds attachment injected at this level — see `TWalkContext.customModelPreservation`. Keyed by the CURRENT namespace being built (`ctx.namespaceKey` — `final`, `cons`, `clone_final`, ...), not hardcoded to `final`. */
  primaryCustomImports: string[];
  stagingCustomImports: string[];
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
  joinRisks: TJoinFieldRisk[];
  objectType: string;
  /** Customer-authored `custom-model.cds` attachments recovered from the currently-committed files (see `custom-model-preserver.ts`) — re-injected into whichever entity they belong to as the tree is walked, instead of being silently dropped by this regenerate. */
  customModelPreservation?: TCustomModelPreservation;
  /** Business tables whose preserved attachment was actually re-injected somewhere in this walk — anything in `customModelPreservation` NOT in here gets a `customModelWarnings` entry (its parent entity no longer exists in this upload). */
  customModelConsumed: Set<string>;
  customModelWarnings: TCustomModelWarning[];
};

function getOrCreateLevelBucket(ctx: TWalkContext, level: number): TLevelBucket {
  return (ctx.csnWithLevel[level] ??= { final: [], staging: [], children: [], businessTables: [], i18n: [], primaryCustomImports: [], stagingCustomImports: [] });
}

/**
 * Recursive composition-tree walk — ported from `OTCSNHelper.buildCSNWithLevel`. Depth-first;
 * "level" = composition-tree depth from the root object type (root = 1), not CSN nesting depth.
 * Mutates `ctx` in place (matches legacy's accumulator style) — does not itself throw on validation
 * issues, only records them into `ctx.errorModel` for the caller to check once the whole tree has
 * been walked (see `buildDbModelForNamespace`'s fail-fast check).
 */
function buildCsnWithLevel(ctx: TWalkContext, modelName: string, currentLevel: number, parentModelName: string | null, parentChain: string[], ancestorModelNames: string[]): void {
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

  // Full ancestor chain INCLUDING this entity itself — used below to detect a composition that
  // loops back to some ancestor further up than its immediate parent (already guarded separately).
  // Unchecked, that would recurse forever (real stack-overflow risk, not just a wrong join) instead
  // of the tree simply terminating like every other leaf.
  const ancestorChain = [...ancestorModelNames, modelName];

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

      if (!ctx.csnContent.definitions[target]) {
        // `target` has NO definition anywhere in the CSN at all — a genuinely dangling reference,
        // distinct from a definition that exists but is merely missing `@sap.label` (that case still
        // recurses into the child below, so the existing `validateSapLabel` fail-fast check reports
        // it properly instead of this one masking it). Left unchecked, rendering would proceed with
        // `targetBusinessTable === undefined` and silently emit literal, invalid CDS text like
        // `to_X : Composition of many undefined`, whose real cause would only surface later as a
        // confusing compile error far from here.
        ctx.joinRisks.push({
          relationName: propertyName,
          parentBusinessTable: businessTable,
          targetBusinessTable: target,
          parentKeyField: propertyName,
          severity: "critical",
          outcome: "dangling-target",
          message: `'${propertyName}' targets '${target}', which has no resolvable CSN definition with an @sap.label — this relation cannot be rendered and is skipped instead of producing invalid CDS.`,
        });
        continue;
      }

      if (ancestorChain.includes(target)) {
        // Loops back to an ancestor further up the tree (or to itself) — NOT the immediate parent
        // (already skipped above, silently, since that's the extremely common and benign
        // "child also has a back-reference to its own parent" shape). Following this one would
        // recurse forever, so it's skipped too, but this shape is unusual enough to flag: it may
        // mean the composition genuinely shouldn't exist on this object type, or needs bespoke
        // handling this generic tree-walk can't provide.
        const cycleTargetBusinessTable = ctx.modelNameToBusinessTable[target] ?? target;
        ctx.joinRisks.push({
          relationName: propertyName,
          parentBusinessTable: businessTable,
          targetBusinessTable: cycleTargetBusinessTable,
          parentKeyField: propertyName,
          severity: "critical",
          outcome: "composition-cycle",
          message: `'${propertyName}' points back to '${cycleTargetBusinessTable}', an ancestor further up this same composition tree (not its immediate parent) — following it would recurse forever, so it's skipped entirely. Verify this composition should exist on this object type at all.`,
        });
        continue;
      }

      const hasOnTokens = Boolean(on?.length);
      const keyIntersectionJoins = hasOnTokens ? [] : deriveJoinKeysFromKeyIntersection(ctx.csnContent, elements, target, ctx.modelNameToBusinessTable[target], propertyName);
      if (!hasOnTokens) {
        ctx.joinRisks.push(...auditKeyIntersectionRisks(ctx.csnContent, elements, businessTable, target, ctx.modelNameToBusinessTable[target], propertyName));
      }
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

      const header = `${propertyName} : ${compositionType} ${targetBusinessTable}`;
      level.final.push(header, ...renderOnClauseLines(relationStringList), ";");

      const stagingRelationStringList = [...relationStringList];
      stagingRelationStringList.splice(1, 0, `${propertyName}.taskID = $self.taskID`);
      level.staging.push(header, ...renderOnClauseLines(stagingRelationStringList), ";");

      (ctx.relationNameToModelName[propertyName] ??= []).push(`${target} - ${targetBusinessTable}`);
      continue;
    }

    if (fieldConfig.target) {
      // Structurally a composition/association (it has a CSN `target`) but its property name
      // doesn't start with `to_` — the ONLY signal this traversal uses to recognize a relation.
      // Confirmed this is a real gap, not theoretical: every relation seen on real customer data so
      // far follows SAP MDG/Gateway's universal `to_`-prefix convention, but nothing enforces it.
      // Without this check, such a field falls through to "normal scalar field" below and renders as
      // an invalid type (`cds.Association`/`cds.Composition` with `cds.` stripped) — worse, its
      // entire subtree is never walked, so any master data under it silently never makes it into
      // the generated model, with no error anywhere.
      const nonStandardTargetBusinessTable = ctx.modelNameToBusinessTable[fieldConfig.target] ?? fieldConfig.target;
      ctx.joinRisks.push({
        relationName: propertyName,
        parentBusinessTable: businessTable,
        targetBusinessTable: nonStandardTargetBusinessTable,
        parentKeyField: propertyName,
        severity: "critical",
        outcome: "non-standard-relation-name",
        message: `'${propertyName}' is a composition/association to '${nonStandardTargetBusinessTable}', but its name doesn't start with '${RELATION_PREFIX}' — this tool only recognizes relations named that way, so '${nonStandardTargetBusinessTable}' and everything under it will be OMITTED from the generated model entirely, with no other error raised.`,
      });
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

  // Keyed off `ctx.namespaceKey` (the namespace THIS pass is actually building — `final`, `cons`,
  // `clone_final`, ...), not hardcoded to `final`: each of those tiers can independently carry its
  // own `custom-model.cds` attachment (confirmed against real customer repos), and this walk is
  // re-run once per namespace pass. `staging` is namespace-invariant and only ever rendered
  // alongside a `final` pass (see `STAGING_BASE_ASPECT`'s doc comment), so it's checked separately.
  const primaryCustomAttachment = ctx.customModelPreservation?.[ctx.namespaceKey]?.byParentEntity[businessTable];
  if (primaryCustomAttachment) {
    level.final.push(...primaryCustomAttachment.compositionLines);
    level.primaryCustomImports.push(...primaryCustomAttachment.importLines);
    ctx.customModelConsumed.add(businessTable);
  }
  if (ctx.namespaceKey === "final") {
    const stagingCustomAttachment = ctx.customModelPreservation?.staging?.byParentEntity[businessTable];
    if (stagingCustomAttachment) {
      level.staging.push(...stagingCustomAttachment.compositionLines);
      level.stagingCustomImports.push(...stagingCustomAttachment.importLines);
      ctx.customModelConsumed.add(businessTable);
    }
  }

  level.final.push("}");
  level.staging.push("}");

  if (MULTI_ERP_MODES.includes(ctx.mode)) {
    mappingFinalForTable.push("}");
    mappingStagingForTable.push("}");
    level.final.push(...mappingFinalForTable);
    level.staging.push(...mappingStagingForTable);
  }

  // Two differently-named relations on this same entity CAN legitimately target the same child
  // model (e.g. `to_CreatedBy`/`to_ChangedBy` both pointing at `User`) — both relation lines above
  // are rendered fully, which is valid CDS, but the child's entity definition must only be walked
  // (and thus written) ONCE, or it would be emitted twice into the same file — a duplicate entity
  // declaration that real CDS compilers reject outright.
  const uniqueChildren = [...new Set(children)];

  level.businessTables.push(businessTable);
  level.children.push(...uniqueChildren);
  ctx.businessTableToChildren[businessTable] = { level: currentLevel, children: [...new Set(businessChildren)] };

  for (const child of uniqueChildren) {
    const newParentChain = currentLevel > 1 ? [...parentChain, businessTable] : [];
    buildCsnWithLevel(ctx, child, currentLevel + 1, modelName, newParentChain, ancestorChain);
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
  joinRisks: TJoinFieldRisk[];
  customModelWarnings: TCustomModelWarning[];
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
export function buildDbModelForNamespace(
  namespaceKey: TDbNamespace,
  csnContent: TCsnContent,
  rootModelName: string,
  objectType: string,
  shortName: string,
  mode: TObjectTypeMode,
  customModelPreservation?: TCustomModelPreservation,
): TDbModelNamespaceResult {
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
    joinRisks: [],
    objectType,
    customModelPreservation,
    customModelConsumed: new Set(),
    customModelWarnings: [],
  };

  buildCsnWithLevel(ctx, rootModelName, 1, null, [], []);

  // `staging` is only ever rendered alongside a `final` pass (see the render loop's own
  // `namespaceKey === "final"` gate below), so it's only relevant to check here for that pass —
  // otherwise a hypothetical future `cons`/`clone_final` call would double-report the same staging
  // gap every time (once per namespace pass) instead of once, from the `final` pass alone.
  const tierKeysToCheck: Array<"staging" | TDbNamespace> = namespaceKey === "final" ? [namespaceKey, "staging"] : [namespaceKey];
  for (const tierKey of tierKeysToCheck) {
    const tierPreservation = customModelPreservation?.[tierKey];
    if (!tierPreservation) continue;
    for (const businessTable of Object.keys(tierPreservation.byParentEntity)) {
      if (ctx.customModelConsumed.has(businessTable)) continue;
      ctx.customModelWarnings.push({
        businessTable,
        message: `A custom-model.cds attachment on '${businessTable}' (${tierKey} tier) could not be re-applied — '${businessTable}' is no longer present in this upload's regenerated model. Its import/composition was NOT carried forward; verify manually before merging.`,
      });
    }
  }

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
    finalLines.push(...new Set(bucket.primaryCustomImports));
    stagingLines.push(`using core.common.${STAGING_BASE_ASPECT} from '@simplemdg/db_common/db/common-model';`);
    if (MULTI_ERP_MODES.includes(mode)) stagingLines.push(`using core.common.${STAGING_MAPPING_ASPECT} from '@simplemdg/db_common/db/common-model';`);
    stagingLines.push(...new Set(bucket.stagingCustomImports));

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

  return { dbActions, srvActions, i18nFragments, joinRisks: ctx.joinRisks, customModelWarnings: ctx.customModelWarnings };
}

/**
 * Finds the CSN's root object-type entity and derives `shortName` from it, instead of requiring an
 * operator-configured short code the way legacy did (`OBJECT_TYPE_DATA[shortName]`). Legacy's own
 * runtime invariant is that the root entity is always keyed `MDG_<ShortName>.<ObjectType>` — this
 * just reads that code back out of the CSN itself, which is more robust than guessing it from a
 * GitLab repo-naming convention and needs no new config.
 */
export function findRootModel(csnContent: TCsnContent, objectType: string): { rootModelName: string; shortName: string } {
  const candidates = Object.entries(csnContent.definitions).filter(([modelName, definition]) => definition?.["@sap.label"] === objectType && /^MDG_[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(modelName));
  if (!candidates.length) {
    throw new Error(`Cannot find a root entity in the imported CSN with @sap.label === "${objectType}" (expected a definition named "MDG_<code>.${objectType}").`);
  }
  if (candidates.length > 1) {
    // Silently picking the first match (object key iteration order — not something a human chose or
    // can predict) would root the whole build on whichever one happens to come first, with no
    // signal that the choice was ambiguous or that a different one might be the intended root.
    throw new Error(
      `Found ${candidates.length} definitions in the imported CSN with @sap.label === "${objectType}": ${candidates.map(([modelName]) => modelName).join(", ")}. Cannot determine which one is the root — the uploaded EDMX must have exactly one.`,
    );
  }
  const [rootModelName] = candidates[0];
  const shortName = rootModelName.split(".")[0].replace(/^MDG_/, "");
  return { rootModelName, shortName };
}

/** The part of a CSN definition name after its namespace prefix (`MDG_CMI.CMIRItemClassification` -> `CMIRItemClassification`) — this is what `cds import` derives directly from the EDMX's own `<EntityType Name="...">` (minus its `Type` suffix), so unlike `@sap.label` it stays stable across re-uploads of the same object type even when the source SAP system's display label changes. */
function technicalSuffix(modelName: string): string {
  const dot = modelName.indexOf(".");
  return dot === -1 ? modelName : modelName.slice(dot + 1);
}

/**
 * Compares every entity's `@sap.label` between a previously-archived CSN and the freshly-imported
 * one, matched by technical name (see `technicalSuffix`) rather than by label — so a label CHANGE is
 * exactly what this catches (matching by label instead would hide it, since the "same" label would
 * simply never be found and look like an unrelated add+remove instead of a rename).
 *
 * Confirmed as a real production incident's root cause: `buildCsnWithLevel` names every generated
 * CDS entity after its `@sap.label`, not its technical name. A relabel-only change on the SAP side
 * (identical `EntityType Name`, different `sap:label`) makes this tool emit a DIFFERENT entity — the
 * old one (backed by a real, already-populated HANA table once deployed) vanishes from the model and
 * an unrelated, empty "new" one takes its place, risking the old table being dropped/orphaned by the
 * next HDI deployment.
 */
export function detectRenamedEntityLabels(previousCsn: TCsnContent | undefined, newCsn: TCsnContent): TEntityRenameRisk[] {
  if (!previousCsn) return [];

  const previousLabels = new Map<string, string>();
  for (const [modelName, definition] of Object.entries(previousCsn.definitions)) {
    const label = definition?.["@sap.label"];
    if (label) previousLabels.set(technicalSuffix(modelName), label);
  }

  const renamed: TEntityRenameRisk[] = [];
  for (const [modelName, definition] of Object.entries(newCsn.definitions)) {
    const newLabel = definition?.["@sap.label"];
    if (!newLabel) continue;
    const technicalName = technicalSuffix(modelName);
    const oldLabel = previousLabels.get(technicalName);
    if (oldLabel && oldLabel !== newLabel) {
      renamed.push({ technicalName, oldLabel, newLabel });
    }
  }
  return renamed;
}
