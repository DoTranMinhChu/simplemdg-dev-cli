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
