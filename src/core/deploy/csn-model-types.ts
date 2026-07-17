/**
 * Shared types for the CSN→CDS DB-model generator (`csn-model-builder.ts`), ported from the legacy
 * `simplemdg_be_gitlab_api_tool`'s `OTCSNHelper`/`ot.interface.ts`. This is the shape `cds import`
 * produces when converting an SAP MDG metadata EDMX export to CSN JSON.
 */

export type TCsnOnRef = { ref: string[] };
export type TCsnOnToken = TCsnOnRef | "and" | "=";

export type TCsnElement = {
  type?: string;
  length?: number;
  precision?: number;
  scale?: number;
  key?: boolean;
  notNull?: boolean;
  target?: string;
  cardinality?: { max?: string };
  on?: TCsnOnToken[];
  /** Only ever set internally by the builder itself for `multiple_erp_central`'s synthetic `targetSystem*` keys — never present in a real `cds import` output. */
  isSystemKey?: boolean;
  "@sap.label"?: string;
  [extra: string]: unknown;
};

export type TCsnDefinition = {
  "@sap.label"?: string;
  kind?: string;
  elements?: Record<string, TCsnElement>;
  [extra: string]: unknown;
};

export type TCsnContent = {
  definitions: Record<string, TCsnDefinition>;
};

/**
 * The legacy tool's `DBNamespace` enum — `final` is the always-generated primary model; `cons`/
 * `clone_final`/`golden_record` are optional additional passes over the same CSN (Phase 3+, not
 * built by Phase 1 of this port).
 */
export type TDbNamespace = "final" | "cons" | "clone_final" | "golden_record";

export type TDbNamespaceConfig = {
  /** CDS namespace suffix, e.g. `<shortNameLowercase>` + this = `bp.model.final`. */
  suffix: string;
  /** `db/<folder>/<ordinal>-model.cds` */
  folder: string;
  firstLevelEntity: string;
  childLevelEntity: string;
  mappingEntity: string;
  /** Fields joined into every generated relation's `on` condition for this namespace. */
  identityKeys: string[];
};

export const DB_NAMESPACE_CONFIG: Record<TDbNamespace, TDbNamespaceConfig> = {
  final: {
    suffix: ".model.final",
    folder: "final",
    firstLevelEntity: "business_1st_level_entity",
    childLevelEntity: "business_child_level_entity",
    mappingEntity: "mapping_entity",
    identityKeys: ["objectID"],
  },
  cons: {
    suffix: ".model.cons",
    folder: "cons",
    firstLevelEntity: "cons_1st_level_entity",
    childLevelEntity: "cons_child_level_entity",
    mappingEntity: "mapping_entity_cons",
    identityKeys: ["requestID"],
  },
  clone_final: {
    suffix: ".model.clonefinal",
    folder: "clone_final",
    firstLevelEntity: "clone_final_1st_level_entity",
    childLevelEntity: "clone_final_child_level_entity",
    mappingEntity: "mapping_entity_clone_final",
    identityKeys: ["objectID", "requestID"],
  },
  golden_record: {
    suffix: ".model.goldenrecord",
    folder: "golden_record",
    firstLevelEntity: "golden_record_1st_level_entity",
    childLevelEntity: "golden_record_child_level_entity",
    mappingEntity: "mapping_entity_golden_record",
    identityKeys: ["sessionID", "changeHash"],
  },
};

/** Staging is namespace-invariant — always the same base aspects/identity keys regardless of which `TDbNamespace` the FINAL pass ran under. */
export const STAGING_BASE_ASPECT = "business_entity_staging";
export const STAGING_MAPPING_ASPECT = "mapping_entity_staging";
export const STAGING_IDENTITY_KEYS = ["objectID", "taskID"];

/**
 * Early-warning findings for structural anomalies in the uploaded EDMX/CSN that this tool's
 * traversal could otherwise get wrong or silently drop — surfaced at preview time, before a deploy
 * commits anything. Three families so far, all confirmed against real customer data or real gaps
 * in the traversal logic:
 *
 * - Join-key mismatches: compositions whose source EDMX has no `<ReferentialConstraint>`, so the
 *   `on` condition has to be reconstructed by matching field names (see
 *   `deriveJoinKeysFromKeyIntersection`/`auditKeyIntersectionRisks`) — confirmed to silently drop or
 *   misjoin a key on real data (CMIR's `CMIRItemClassification` → `Characteristics` relation).
 * - Non-standard relation naming: the traversal only recognizes a composition/association by its
 *   property name starting with `to_` (the universal SAP MDG/Gateway convention) — an association
 *   with a `target`/`cds.Association` type but a differently-named property is invisible to the
 *   walk and its entire subtree is silently omitted, with no error at all (see
 *   `auditNonStandardRelationNames`).
 * - Composition cycles: a child composition pointing back to an ANCESTOR further up than its
 *   immediate parent (already guarded) would recurse forever — detected and skipped instead of
 *   crashing with a stack overflow (see the `ancestorModelNames` check in `buildCsnWithLevel`).
 * - Dangling targets: a composition/association whose CSN `target` has no resolvable definition
 *   (missing, or present but with no `@sap.label`) would otherwise render literally as `Composition
 *   of many undefined` — invalid CDS that would only surface as a confusing compile error later,
 *   far from its actual cause.
 */
export type TJoinRiskSeverity = "critical" | "high" | "medium" | "info";

export type TJoinFieldRisk = {
  relationName: string;
  parentBusinessTable: string;
  targetBusinessTable: string;
  parentKeyField: string;
  severity: TJoinRiskSeverity;
  outcome: "dropped-no-suggestion" | "dropped-with-label-suggestion" | "label-mismatch" | "resolved-by-override" | "non-standard-relation-name" | "composition-cycle" | "dangling-target";
  message: string;
};

/**
 * An entity's `@sap.label` (its EDMX `sap:label`) changed between this object type's last deploy
 * and the freshly-uploaded EDMX, while its underlying EDMX `EntityType` technical name (e.g.
 * `CMIRItemTextType`) stayed the same. Confirmed on real customer data as the actual root cause of a
 * production incident: this tool names/generates each CDS entity after its `@sap.label` (not the
 * stable technical name), so a label change makes it emit a DIFFERENT entity — the old one (backed
 * by a real, populated HANA table) silently disappears from the generated model and a same-shaped
 * but unrelated "new" entity takes its place. If that reaches an HDI deployment, the old physical
 * table can be dropped/orphaned and the new one created empty — real data-loss risk, not just a
 * cosmetic rename. See `detectRenamedEntityLabels` in `csn-model-builder.ts`.
 */
export type TEntityRenameRisk = {
  technicalName: string;
  oldLabel: string;
  newLabel: string;
};
