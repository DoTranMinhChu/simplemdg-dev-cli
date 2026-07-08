import { useEffect, useState } from "react";
import { SearchInput } from "../common/SearchInput";
import { EmptyState } from "../common/EmptyState";
import { Button } from "../common/Button";
import { studioApi } from "../../api/studio-api-client";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useStudioStore } from "../../state/studio-store";
import type { TQueryHistoryItem } from "../../api/studio-api-types";

export function QueryHistoryPanel(): React.ReactElement {
  const [history, setHistory] = useState<TQueryHistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const { openTab } = useWorkspaceStore();
  const { connections, setActiveConnectionId, toast } = useStudioStore();

  const load = (): void => {
    studioApi
      .getHistory()
      .then((response) => setHistory(response.history))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, []);

  const openHistoryItem = (item: TQueryHistoryItem): void => {
    if (item.connectionId) {
      const connection = connections.find((candidate) => candidate.id === item.connectionId);
      if (connection) setActiveConnectionId(connection.id);
      else toast("Original connection was removed; opening SQL without switching connection.", "warn");
    }
    openTab({ key: `sql:hist:${item.id}`, kind: "sql", title: "History", connectionId: item.connectionId, sql: item.sql });
  };

  const clear = async (): Promise<void> => {
    if (!window.confirm("Clear all query history?")) return;
    await studioApi.clearHistory();
    load();
    toast("History cleared.");
  };

  const lowerQ = search.toLowerCase();
  const filtered = history.filter((item) => `${item.sql} ${item.connectionName ?? ""}`.toLowerCase().includes(lowerQ));

  return (
    <div>
      <div className="searchbox-row">
        <SearchInput value={search} onChange={setSearch} placeholder="Search history..." />
      </div>
      {!filtered.length ? (
        <EmptyState>{history.length ? "No results found" : "No query history yet."}</EmptyState>
      ) : (
        filtered.map((item) => {
          const preview = item.sql.replace(/\s+/g, " ").trim();
          return (
            <div key={item.id} className="wli" onClick={() => openHistoryItem(item)}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className={`st-dot ${item.success ? "ok" : "err"}`} />
                <b>{preview.length > 70 ? `${preview.slice(0, 70)}…` : preview}</b>
              </div>
              <div className="note">
                {item.connectionName ?? "(no connection)"} · {new Date(item.timestamp).toLocaleString()}
                {item.success ? ` · ${item.durationMs}ms` : " · failed"}
              </div>
            </div>
          );
        })
      )}
      {history.length ? (
        <div className="row right" style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear history
          </Button>
        </div>
      ) : null}
    </div>
  );
}
