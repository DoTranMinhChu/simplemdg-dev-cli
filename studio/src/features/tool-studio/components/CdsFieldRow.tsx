import { Button } from "../../../components/common/Button";
import { CDS_FIELD_TYPES } from "../constants/cds-field-types";

/** Structural shape shared by `TCustomModelField` (Custom Model) and `TManualDraftField` (Deploy Model's manual editor) — both satisfy this without an explicit shared type import. */
export type TCdsFieldRowValue = { name: string; type: string; isKey: boolean; i18nLabel?: string };

/**
 * One field's name/type/key/i18n-label row — used by both `CustomModelStep` and `ManualModelEditor`
 * so a field authored in either editor looks and behaves identically. Extracted verbatim from
 * `CustomModelStep`'s original inline `FieldRow` (no behavior change).
 */
export function CdsFieldRow<TField extends TCdsFieldRowValue>({ field, onChange, onRemove, disableNameEdit }: { field: TField; onChange: (next: TField) => void; onRemove?: () => void; disableNameEdit?: boolean }): React.ReactElement {
  return (
    <div className="row" style={{ gap: 8, marginBottom: 6, alignItems: "center" }}>
      <input className="input" style={{ flex: 1 }} placeholder="fieldName" value={field.name} disabled={disableNameEdit} onChange={(event) => onChange({ ...field, name: event.target.value })} />
      <select className="select" style={{ width: 140 }} value={field.type} onChange={(event) => onChange({ ...field, type: event.target.value })}>
        {CDS_FIELD_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={field.isKey} onChange={(event) => onChange({ ...field, isKey: event.target.checked })} /> key
      </label>
      <input className="input" style={{ flex: 1 }} placeholder="i18n label" value={field.i18nLabel ?? ""} onChange={(event) => onChange({ ...field, i18nLabel: event.target.value })} />
      {onRemove && (
        <Button variant="sec" size="sm" onClick={onRemove}>
          ✕
        </Button>
      )}
    </div>
  );
}
