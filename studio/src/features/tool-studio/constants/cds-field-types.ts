/**
 * CDS field type choices offered by every field-editing UI in Tool Studio (Custom Model's
 * `CustomModelStep` and Deploy Model's `ManualModelEditor`) — kept as one shared list so both stay
 * in lockstep and a field authored in either editor round-trips the same way through the backend's
 * `parseCdsTypeString`/`cdsTypeToDisplayString` (`src/core/deploy/csn-manual-editor.ts`).
 */
export const CDS_FIELD_TYPES = ["String", "String(10)", "String(18)", "String(40)", "LargeString", "Integer", "Decimal(15,2)", "Boolean", "Date", "DateTime", "UUID"];
