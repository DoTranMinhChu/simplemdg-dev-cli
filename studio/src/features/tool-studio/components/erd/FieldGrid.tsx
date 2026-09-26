import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../../components/common/Icon";
import { CDS_FIELD_TYPES } from "../../constants/cds-field-types";
import type { TErdField } from "./erd-types";

/**
 * Dense, spreadsheet-like field editor for one entity (replaces the old one-40px-row-of-inputs-per-
 * field `CdsFieldRow`): key toggle, name, type, i18n label, delete — one compact row each, with a
 * filter box for 100+-field entities and inline flags for empty/duplicate names. `lockedFieldNames`
 * rows (e.g. the manual editor's mandatory `objectID`) can't be renamed or deleted.
 */
export function FieldGrid<TField extends TErdField>({
  fields,
  onChange,
  newField,
  lockedFieldNames,
  readOnly,
}: {
  fields: TField[];
  onChange?: (next: TField[]) => void;
  newField?: () => TField;
  lockedFieldNames?: ReadonlySet<string>;
  readOnly?: boolean;
}): React.ReactElement {
  const [filter, setFilter] = useState("");
  const [focusIndex, setFocusIndex] = useState<number | undefined>();
  const tableRef = useRef<HTMLTableElement>(null);
  const query = filter.trim().toLowerCase();

  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const field of fields) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
    return counts;
  }, [fields]);

  const rows = fields
    .map((field, index) => ({ field, index }))
    .filter(({ field }) => !query || field.name.toLowerCase().includes(query) || (field.i18nLabel ?? "").toLowerCase().includes(query) || field.type.toLowerCase().includes(query));

  useEffect(() => {
    if (focusIndex === undefined) return;
    tableRef.current?.querySelector<HTMLInputElement>(`input[data-field-name="${focusIndex}"]`)?.focus();
    setFocusIndex(undefined);
  }, [focusIndex]);

  const update = (index: number, patch: Partial<TErdField>): void => onChange?.(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  const keyCount = fields.filter((field) => field.isKey).length;

  return (
    <div className="erd-fieldgrid">
      <div className="erd-fieldgrid-bar">
        <input className="input erd-fieldgrid-filter" placeholder={`Filter ${fields.length} fields…`} value={filter} onChange={(event) => setFilter(event.target.value)} />
        <span className="note">{keyCount} key{keyCount === 1 ? "" : "s"}{query ? ` · ${rows.length} shown` : ""}</span>
      </div>
      <div className="erd-fieldgrid-scroll">
        <table className="erd-fieldgrid-table" ref={tableRef}>
          <thead>
            <tr>
              <th className="col-key" title="Key field">
                <Icon name="key" />
              </th>
              <th>Name</th>
              <th className="col-type">Type</th>
              <th className="col-label">Label</th>
              {!readOnly && <th className="col-del" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ field, index }) => {
              const locked = lockedFieldNames?.has(field.name) ?? false;
              const problem = !field.name.trim() ? "Field name is required" : (nameCounts.get(field.name) ?? 0) > 1 ? "Duplicate field name" : undefined;
              const typeOptions = CDS_FIELD_TYPES.includes(field.type) ? CDS_FIELD_TYPES : [field.type, ...CDS_FIELD_TYPES];
              if (readOnly) {
                return (
                  <tr key={index} className={field.isKey ? "is-key" : undefined}>
                    <td className="col-key">{field.isKey && <Icon name="key" />}</td>
                    <td className="mono">{field.name}</td>
                    <td className="col-type mono">{field.type}</td>
                    <td className="plain">{field.i18nLabel}</td>
                  </tr>
                );
              }
              return (
                <tr key={index} className={`${field.isKey ? "is-key" : ""}${problem ? " has-problem" : ""}`} title={problem}>
                  <td className="col-key">
                    <button
                      type="button"
                      className={`erd-key-toggle${field.isKey ? " on" : ""}`}
                      aria-pressed={field.isKey}
                      title={field.isKey ? "Key field — click to unset" : "Make this a key field"}
                      disabled={locked}
                      onClick={() => update(index, { isKey: !field.isKey })}
                    >
                      <Icon name="key" />
                    </button>
                  </td>
                  <td>
                    <input className="erd-cell mono" data-field-name={index} placeholder="fieldName" title={field.name} value={field.name} disabled={locked} onChange={(event) => update(index, { name: event.target.value })} />
                  </td>
                  <td className="col-type">
                    <select className="erd-cell mono" value={field.type} onChange={(event) => update(index, { type: event.target.value })}>
                      {typeOptions.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input className="erd-cell" placeholder="i18n label" title={field.i18nLabel} value={field.i18nLabel ?? ""} onChange={(event) => update(index, { i18nLabel: event.target.value })} />
                  </td>
                  <td className="col-del">
                    {!locked && (
                      <button type="button" className="erd-row-delete" title={`Remove ${field.name || "field"}`} onClick={() => onChange?.(fields.filter((_, i) => i !== index))}>
                        <Icon name="x" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={readOnly ? 4 : 5} className="note" style={{ textAlign: "center", padding: 12 }}>
                  {fields.length ? "No field matches the filter." : "No fields yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!readOnly && newField && (
        <button
          type="button"
          className="erd-add-row"
          onClick={() => {
            setFilter("");
            onChange?.([...fields, newField()]);
            setFocusIndex(fields.length);
          }}
        >
          <Icon name="plus" /> Add field
        </button>
      )}
    </div>
  );
}
