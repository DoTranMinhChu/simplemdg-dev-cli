import { IconButton } from "../common/IconButton";
import { SearchInput } from "../common/SearchInput";
import { StudioMark } from "../common/StudioMark";
import { useStudioStore } from "../../state/studio-store";
import { useWorkspaceStore } from "../../state/workspace-store";

function isProdConnection(org?: string, app?: string, space?: string, environment?: string): boolean {
  const haystack = `${environment ?? ""} ${org ?? ""} ${app ?? ""} ${space ?? ""}`.toLowerCase();
  return /prod|production|prd|live/.test(haystack);
}

export function TopBar({
  onImport,
  onHome,
  onSettings,
  onToggleSidebar,
  connectionSearch,
  onConnectionSearchChange,
}: {
  onImport: () => void;
  onHome: () => void;
  onSettings: () => void;
  onToggleSidebar: () => void;
  connectionSearch: string;
  onConnectionSearchChange: (value: string) => void;
}): React.ReactElement {
  const { activeConnection, activeSchema } = useStudioStore();
  const { layout, setReadOnly } = useWorkspaceStore();
  const readOnly = layout.readOnly;

  const toggleReadOnly = (): void => setReadOnly(!readOnly);

  const prodLike = activeConnection ? isProdConnection(activeConnection.org, activeConnection.app, activeConnection.space, activeConnection.environment) : false;

  return (
    <header className="topbar">
      <span className="brand">
        <StudioMark studio="db" />
        SimpleMDG <span className="b2">DB Studio</span>
      </span>
      <span className={`badge${activeConnection ? " on" : ""}`}>{activeConnection ? `Conn: ${activeConnection.name}` : "No connection"}</span>
      {activeConnection ? (
        <span className={`badge ${activeConnection.type === "hana" ? "hana" : "pg"}`}>{activeConnection.type === "hana" ? "HANA" : "PostgreSQL"}</span>
      ) : null}
      <span className="badge">Schema: {activeSchema || "-"}</span>
      {prodLike ? <span className="badge prod">Production-like</span> : null}
      <span className={`badge ro${readOnly ? " active" : ""}`} onClick={toggleReadOnly} role="button" tabIndex={0} title="Toggle read-only">
        {readOnly ? "Read-only" : "Read/Write"}
      </span>
      <span className="grow" />
      <SearchInput
        className="top-search"
        value={connectionSearch}
        onChange={onConnectionSearchChange}
        placeholder="Search connections..."
      />
      <IconButton icon="imp" label="Import from BTP app" primary onClick={onImport} />
      <IconButton icon="home" label="Welcome" onClick={onHome} />
      <IconButton icon="col" label="Toggle sidebar" onClick={onToggleSidebar} />
      <IconButton icon="gear" label="Settings" onClick={onSettings} />
    </header>
  );
}
