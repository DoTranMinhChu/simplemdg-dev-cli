import { useMemo, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { highlightMatch } from "../../../lib/highlight-match";
import type { TFileImpact } from "../../../api/ai-studio-api-types";

type TSortKey = "edits" | "reads" | "path" | "lastTurnIndex";

/** §14 — full file impact table (analysis.fileImpact, already computed server-side). */
export function FilesView({ fileImpact, onJumpToTurn }: { fileImpact: TFileImpact[]; onJumpToTurn: (turnIndex: number) => void }): React.ReactElement {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<TSortKey>("edits");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? fileImpact.filter((file) => file.path.toLowerCase().includes(q)) : fileImpact;
    return [...filtered].sort((a, b) => {
      if (sortKey === "path") return a.path.localeCompare(b.path);
      if (sortKey === "reads") return b.reads - a.reads;
      if (sortKey === "lastTurnIndex") return b.lastTurnIndex - a.lastTurnIndex;
      return b.edits - a.edits;
    });
  }, [fileImpact, query, sortKey]);

  if (!fileImpact.length) return <EmptyState>No file activity recorded.</EmptyState>;

  return (
    <div className="files-view">
      <div className="row" style={{ gap: 8, marginBottom: 10 }}>
        <input placeholder="Filter by path…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select value={sortKey} onChange={(event) => setSortKey(event.target.value as TSortKey)}>
          <option value="edits">Sort: most edits</option>
          <option value="reads">Sort: most reads</option>
          <option value="lastTurnIndex">Sort: most recent</option>
          <option value="path">Sort: path</option>
        </select>
      </div>
      <table className="grid">
        <thead>
          <tr>
            <th>Path</th>
            <th>Reads</th>
            <th>Edits</th>
            <th>First turn</th>
            <th>Last turn</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((file) => (
            <tr key={file.path}>
              <td>
                <code>{query ? highlightMatch(file.path, query) : file.path}</code>
              </td>
              <td>{file.reads}</td>
              <td>{file.edits}</td>
              <td>{file.firstTurnIndex}</td>
              <td>{file.lastTurnIndex}</td>
              <td>
                <button type="button" onClick={() => onJumpToTurn(file.lastTurnIndex)}>
                  View in conversation
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
