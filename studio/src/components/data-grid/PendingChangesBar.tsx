export function PendingChangesBar({
  updates,
  inserts,
  deletes,
  onSave,
  onRevert,
}: {
  updates: number;
  inserts: number;
  deletes: number;
  onSave: () => void;
  onRevert: () => void;
}): React.ReactElement | null {
  const total = updates + inserts + deletes;
  if (!total) return null;

  return (
    <div className="changebar">
      <span>
        Pending: <span className="cnt-u">{updates} edits</span> · <span className="cnt-i">{inserts} inserts</span> · <span className="cnt-d">{deletes} deletes</span>
      </span>
      <span className="grow" />
      <button className="btn sm" title="Ctrl+S" onClick={onSave}>
        Save
      </button>
      <button className="btn sm ghost" onClick={onRevert}>
        Revert
      </button>
    </div>
  );
}
