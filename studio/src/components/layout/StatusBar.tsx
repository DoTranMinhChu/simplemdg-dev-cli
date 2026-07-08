import { useStudioStore } from "../../state/studio-store";

export function StatusBar(): React.ReactElement {
  const { statusBar } = useStudioStore();

  return (
    <footer className="statusbar">
      <span className="st-item">
        <span className={`st-dot ${statusBar.connectionKind}`} /> {statusBar.connectionLabel}
      </span>
      <span className="st-item">Duration: {statusBar.duration}</span>
      <span className="st-item">Rows: {statusBar.rows}</span>
      <span className="grow" style={{ flex: 1 }} />
      {statusBar.pendingCount > 0 ? (
        <span className="st-item st-pending">
          {statusBar.pendingCount} pending change{statusBar.pendingCount > 1 ? "s" : ""}
        </span>
      ) : null}
      <span className="st-item faint">Local only · 127.0.0.1</span>
    </footer>
  );
}
