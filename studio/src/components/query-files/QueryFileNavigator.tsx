import { useEffect, useState } from "react";
import { SearchInput } from "../common/SearchInput";
import { EmptyState } from "../common/EmptyState";
import { ContextMenu, type TContextMenuState } from "../common/ContextMenu";
import { studioApi } from "../../api/studio-api-client";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useStudioStore } from "../../state/studio-store";
import { highlightMatch } from "../../lib/highlight-match";
import type { TSavedQuery } from "../../api/studio-api-types";

export function QueryFileNavigator(): React.ReactElement {
  const [queries, setQueries] = useState<TSavedQuery[]>([]);
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<(TContextMenuState & { query: TSavedQuery }) | null>(null);
  const { openTab } = useWorkspaceStore();
  const { toast } = useStudioStore();

  const load = (): void => {
    studioApi
      .getSavedQueries()
      .then((response) => setQueries(response.queries))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, []);

  const openQuery = (query: TSavedQuery): void => {
    openTab({ key: `sql:query:${query.id}`, kind: "sql", title: query.name, connectionId: query.connectionId, sql: query.sql, queryId: query.id });
  };

  const renameQuery = async (query: TSavedQuery): Promise<void> => {
    const name = window.prompt("New name", query.name);
    if (!name || name === query.name) return;
    await studioApi.updateSavedQuery(query.id, { name });
    load();
  };

  const deleteQuery = async (query: TSavedQuery): Promise<void> => {
    if (!window.confirm(`Delete '${query.name}'?`)) return;
    await studioApi.deleteSavedQuery(query.id);
    toast(`Deleted ${query.name}`);
    load();
  };

  const lowerQ = search.toLowerCase();
  const filtered = queries.filter((query) => `${query.name} ${(query.tags ?? []).join(" ")}`.toLowerCase().includes(lowerQ));

  return (
    <div>
      <div className="searchbox-row">
        <SearchInput value={search} onChange={setSearch} placeholder="Search saved queries..." />
      </div>
      {!filtered.length ? (
        <EmptyState>{queries.length ? "No results found" : "No saved queries."}</EmptyState>
      ) : (
        filtered.map((query) => (
          <div
            key={query.id}
            className="wli"
            onClick={() => openQuery(query)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ x: event.clientX, y: event.clientY, query, items: [] });
            }}
          >
            <b>{highlightMatch(query.name, search)}</b>
            <div className="note">
              {query.connectionType ?? ""} · {new Date(query.updatedAt).toLocaleDateString()}
            </div>
          </div>
        ))
      )}
      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: "Open", icon: "sql", onClick: () => openQuery(contextMenu.query) },
            { label: "Rename", icon: "gear", onClick: () => renameQuery(contextMenu.query) },
            { sep: true },
            { label: "Delete", icon: "x", danger: true, onClick: () => deleteQuery(contextMenu.query) },
          ]}
        />
      ) : null}
    </div>
  );
}
