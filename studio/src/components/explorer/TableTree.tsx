import { useCallback, useEffect, useState } from "react";
import { ObjectTreeNode } from "./ObjectTreeNode";
import { ContextMenu, type TContextMenuState } from "../common/ContextMenu";
import { SearchInput } from "../common/SearchInput";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { studioApi } from "../../api/studio-api-client";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useStudioStore } from "../../state/studio-store";
import type { TDatabaseObject, TDatabaseObjectKind } from "../../api/studio-api-types";

const DATA_CAPABLE_KINDS: TDatabaseObjectKind[] = ["table", "view", "column-view"];

export function TableTree({
  connectionId,
  schema,
  kind,
  label,
  icon,
}: {
  connectionId: string;
  schema: string;
  kind: TDatabaseObjectKind;
  label: string;
  icon: string;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [objects, setObjects] = useState<TDatabaseObject[] | undefined>(undefined);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<(TContextMenuState & { object: TDatabaseObject }) | null>(null);
  const debouncedSearch = useDebouncedValue(search, 250);
  const { openTab } = useWorkspaceStore();
  const { toast } = useStudioStore();

  const load = useCallback(async () => {
    if (kind === "index") {
      setObjects([]);
      return;
    }
    setLoading(true);
    try {
      const response = await studioApi.getObjects(connectionId, schema, [kind], debouncedSearch);
      if (response.error) {
        setError(response.error);
        setObjects([]);
      } else {
        setError(undefined);
        setObjects(response.objects ?? []);
      }
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      setObjects([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId, schema, kind, debouncedSearch]);

  useEffect(() => {
    if (expanded) load();
  }, [expanded, load]);

  const openData = (object: TDatabaseObject): void => {
    openTab({
      key: `data:${connectionId}:${schema}.${object.name}`,
      kind: "data-grid",
      title: object.name,
      connectionId,
      schema,
      objectName: object.name,
      objectType: object.kind === "view" ? "view" : "table",
    });
  };

  const openStructure = (object: TDatabaseObject): void => {
    openTab({
      key: `struct:${connectionId}:${schema}.${object.name}`,
      kind: "metadata",
      title: `Structure: ${object.name}`,
      connectionId,
      schema,
      objectName: object.name,
      objectType: object.kind === "view" ? "view" : "table",
    });
  };

  const canOpenData = DATA_CAPABLE_KINDS.includes(kind);

  const generateSelect = async (object: TDatabaseObject, mode: "open" | "copy"): Promise<void> => {
    const { select } = await studioApi.generateTableSql(connectionId, schema, object.name, 100);
    if (mode === "copy") {
      navigator.clipboard.writeText(select);
      toast("Copied SELECT statement");
    } else {
      openTab({ key: `sql:${Date.now()}`, kind: "sql", title: `SELECT ${object.name}`, connectionId, sql: select });
    }
  };

  const generateCount = async (object: TDatabaseObject): Promise<void> => {
    const { count } = await studioApi.generateTableSql(connectionId, schema, object.name, 100);
    openTab({ key: `sql:${Date.now()}`, kind: "sql", title: `COUNT ${object.name}`, connectionId, sql: count });
  };

  const copyTemplate = async (object: TDatabaseObject, template: "insert" | "update"): Promise<void> => {
    const generated = await studioApi.generateFullTableSql(connectionId, schema, object.name, 100);
    navigator.clipboard.writeText(generated[template]);
    toast(`Copied ${template.toUpperCase()} template`);
  };

  return (
    <ObjectTreeNode label={label} icon={icon} expanded={expanded} loading={loading} badge={objects ? objects.length : null} onToggle={() => setExpanded((prev) => !prev)}>
      {kind === "index" ? (
        <div className="tnote">Open a table&apos;s Structure to view its indexes.</div>
      ) : (
        <>
          <div className="searchbox tsearch">
            <SearchInput value={search} onChange={setSearch} placeholder={`Search ${label.toLowerCase()}...`} />
          </div>
          {loading ? (
            <div className="tnote">
              <span className="spin" /> loading...
            </div>
          ) : error ? (
            <div className="tnote">{error}</div>
          ) : !objects?.length ? (
            <div className="tnote">{search ? "No results found" : "None."}</div>
          ) : (
            objects.map((object) => (
              <ObjectTreeNode
                key={object.name}
                label={object.name}
                icon={icon}
                leaf
                onClick={() => undefined}
                onDoubleClick={canOpenData ? () => openData(object) : undefined}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setContextMenu({ x: event.clientX, y: event.clientY, object, items: [] });
                }}
              />
            ))
          )}
        </>
      )}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={
            canOpenData
              ? [
                  { label: "Open Data", icon: "table2", onClick: () => openData(contextMenu.object) },
                  { label: "Open Structure", icon: "col", onClick: () => openStructure(contextMenu.object) },
                  { sep: true },
                  { label: "Generate SELECT", icon: "sql", onClick: () => generateSelect(contextMenu.object, "open") },
                  { label: "Generate COUNT", icon: "sql", onClick: () => generateCount(contextMenu.object) },
                  { label: "Copy SELECT", icon: "sql", onClick: () => generateSelect(contextMenu.object, "copy") },
                  { label: "Copy INSERT template", icon: "sql", onClick: () => copyTemplate(contextMenu.object, "insert") },
                  { label: "Copy UPDATE template", icon: "sql", onClick: () => copyTemplate(contextMenu.object, "update") },
                  { sep: true },
                  {
                    label: "Copy Full Name",
                    icon: "col",
                    onClick: () => {
                      const qualified = `"${schema}"."${contextMenu.object.name}"`;
                      navigator.clipboard.writeText(qualified);
                      toast(`Copied ${qualified}`);
                    },
                  },
                  { label: "Copy Name", icon: "col", onClick: () => { navigator.clipboard.writeText(contextMenu.object.name); toast(`Copied ${contextMenu.object.name}`); } },
                ]
              : [
                  { label: "Copy Name", icon: "col", onClick: () => { navigator.clipboard.writeText(contextMenu.object.name); toast(`Copied ${contextMenu.object.name}`); } },
                ]
          }
        />
      ) : null}
    </ObjectTreeNode>
  );
}
