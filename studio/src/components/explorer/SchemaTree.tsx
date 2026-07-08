import { useState } from "react";
import { ObjectTreeNode } from "./ObjectTreeNode";
import { TableTree } from "./TableTree";
import type { TDatabaseObjectKind } from "../../api/studio-api-types";

const FOLDERS: Array<{ label: string; kind: TDatabaseObjectKind; icon: string }> = [
  { label: "Tables", kind: "table", icon: "tbl" },
  { label: "Views", kind: "view", icon: "viw" },
  { label: "Procedures", kind: "procedure", icon: "prc" },
  { label: "Functions", kind: "function", icon: "fun" },
  { label: "Synonyms", kind: "synonym", icon: "syn" },
  { label: "Indexes", kind: "index", icon: "idx" },
];

export function SchemaTree({ connectionId, schema, onSelect }: { connectionId: string; schema: string; onSelect: (schema: string) => void }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  return (
    <ObjectTreeNode
      label={schema}
      icon="sch"
      expanded={expanded}
      onToggle={() => setExpanded((prev) => !prev)}
      onClick={() => {
        onSelect(schema);
        setExpanded((prev) => !prev);
      }}
    >
      {FOLDERS.map((folder) => (
        <TableTree key={folder.kind} connectionId={connectionId} schema={schema} kind={folder.kind} label={folder.label} icon={folder.icon} />
      ))}
    </ObjectTreeNode>
  );
}
