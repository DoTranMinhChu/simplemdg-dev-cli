import { Icon } from "../common/Icon";
import { Spinner } from "../common/Spinner";
import { SqlAutocompleteTextarea, type TSqlSuggestionItem } from "../common/SqlAutocompleteTextarea";
import { WHERE_CLAUSE_KEYWORDS } from "../../lib/sql-keywords";
import type { TDatabaseColumn } from "../../api/studio-api-types";

export function DataGridToolbar({
  where,
  onWhereChange,
  onApplyFilter,
  onRefresh,
  refreshing,
  onInsertRow,
  onDeleteSelected,
  canEdit,
  onOpenStructure,
  onExport,
  columns,
}: {
  where: string;
  onWhereChange: (value: string) => void;
  onApplyFilter: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  onInsertRow: () => void;
  onDeleteSelected: () => void;
  canEdit: boolean;
  onOpenStructure: () => void;
  onExport: () => void;
  /** The current table's columns, offered as autocomplete while typing the WHERE clause. */
  columns?: TDatabaseColumn[];
}): React.ReactElement {
  const suggestions: TSqlSuggestionItem[] = [
    ...(columns ?? []).map((column) => ({ text: column.name, kind: "column" as const, detail: column.dataType })),
    ...WHERE_CLAUSE_KEYWORDS.map((text) => ({ text, kind: "keyword" as const })),
  ];

  return (
    <div className="gtoolbar">
      <div className={`wherebox${where ? " has" : ""}`}>
        <Icon name="filter" />
        <SqlAutocompleteTextarea
          value={where}
          // A pasted multi-line WHERE would otherwise grow this into a multi-row box (it's a
          // <textarea> underneath, for the autocomplete popover) and wreck the toolbar's height.
          onChange={(value) => onWhereChange(value.replace(/\r?\n/g, " "))}
          suggestions={suggestions}
          placeholder="WHERE clause, e.g. STATUS = 'A'"
          rows={1}
          resize="none"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onApplyFilter();
            }
          }}
        />
        <span className="clr" onClick={() => { onWhereChange(""); onApplyFilter(); }}>
          <Icon name="x" />
        </span>
      </div>
      <button className="gbtn" title="Apply filter (Enter)" onClick={onApplyFilter}>
        <Icon name="run" />
      </button>
      <button className={`gbtn${refreshing ? " spinning" : ""}`} title="Refresh data" onClick={onRefresh}>
        {refreshing ? <Spinner /> : <Icon name="refresh" />}
      </button>
      <span className="gsep" />
      <button className="gbtn" title="Insert row" disabled={!canEdit} onClick={onInsertRow}>
        <Icon name="plus" />
      </button>
      <button className="gbtn danger" title="Mark selected rows for delete" disabled={!canEdit} onClick={onDeleteSelected}>
        <Icon name="trash" />
      </button>
      <button className="gbtn" title="Open structure" onClick={onOpenStructure}>
        <Icon name="col" />
      </button>
      <span className="gsep" />
      <button className="gbtn" title="Export data" onClick={onExport}>
        <Icon name="imp" />
      </button>
    </div>
  );
}
