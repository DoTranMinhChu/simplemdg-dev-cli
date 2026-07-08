import { Icon } from "../common/Icon";
import { Spinner } from "../common/Spinner";

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
}): React.ReactElement {
  return (
    <div className="gtoolbar">
      <div className={`wherebox${where ? " has" : ""}`}>
        <Icon name="filter" />
        <input
          value={where}
          placeholder="WHERE clause, e.g. STATUS = 'A'"
          onChange={(event) => onWhereChange(event.target.value)}
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
