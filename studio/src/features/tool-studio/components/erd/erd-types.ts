/**
 * Editor-agnostic ERD shapes shared by Deploy Model's "Edit Model Manually" (`ManualModelEditor`)
 * and the Custom Model step (`CustomModelStep`) — each editor maps its own draft onto these for the
 * canvas and keeps its own editing semantics in its inspector panel.
 */
export type TErdField = { name: string; type: string; isKey: boolean; i18nLabel?: string };

/** Drives the node's accent color + badge: `root` (the object type's root), `entity` (a regular manual-model entity), `custom` (a custom-model.cds entity), `generated` (read-only, from db/final/*-model.cds). */
export type TErdNodeKind = "root" | "entity" | "custom" | "generated";

export type TErdEntity = {
  id: string;
  title: string;
  /** Faint secondary line under the title (a technical id, a source file). */
  subtitle?: string;
  kind: TErdNodeKind;
  fields: TErdField[];
};

export type TErdEdge = {
  id: string;
  source: string;
  target: string;
  /** Relation/association name, shown on the edge next to the cardinality. */
  label: string;
  cardinality: "one" | "many";
  /** `attach` = a custom entity attached to a generated one (drawn dashed); everything else is a composition. */
  kind: "composition" | "attach";
};

/** A request for the canvas to pan to one node — `token` changes on every request so asking for the same node twice still re-centers. */
export type TErdFocusRequest = { id: string; token: number };

export const ERD_KIND_LABEL: Record<TErdNodeKind, string | undefined> = { root: "ROOT", entity: undefined, custom: "CUSTOM", generated: "GENERATED" };

/** True when `query` (already lower-cased) matches the entity's title, subtitle or any field name. */
export function erdEntityMatches(entity: TErdEntity, query: string): boolean {
  if (!query) return true;
  if (entity.title.toLowerCase().includes(query) || entity.subtitle?.toLowerCase().includes(query)) return true;
  return entity.fields.some((field) => field.name.toLowerCase().includes(query));
}
