import { Icon } from "../common/Icon";

export function DataGridFooter({
  rangeText,
  durationText,
  pageSize,
  onPageSizeChange,
  onPrevPage,
  onNextPage,
}: {
  rangeText: string;
  durationText: string;
  pageSize: string;
  onPageSizeChange: (value: string) => void;
  onPrevPage: () => void;
  onNextPage: () => void;
}): React.ReactElement {
  return (
    <div className="gridfoot">
      <span className="note">{rangeText}</span>
      <span style={{ flex: 1 }} />
      <span className="pg">
        <button className="gbtn" title="Previous page" onClick={onPrevPage}>
          <Icon name="chevL" />
        </button>
        <span className="note">Rows</span>
        <select value={pageSize} onChange={(event) => onPageSizeChange(event.target.value)}>
          {["100", "500", "1000"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <button className="gbtn" title="Next page" onClick={onNextPage}>
          <Icon name="chevR" />
        </button>
      </span>
      <span className="note">{durationText}</span>
    </div>
  );
}
