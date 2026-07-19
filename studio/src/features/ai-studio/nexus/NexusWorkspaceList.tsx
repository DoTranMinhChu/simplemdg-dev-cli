import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { nexusApi } from "../../../api/nexus-api-client";

type TProps = {
  names: string[];
  selectedName: string | undefined;
  onSelect: (name: string) => void;
  onChanged: () => void;
  toast: (message: string, kind?: "ok" | "err" | "warn") => void;
};

export function NexusWorkspaceList({ names, selectedName, onSelect, onChanged, toast }: TProps): React.ReactElement {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const create = async (): Promise<void> => {
    if (!newName.trim()) return;
    try {
      const result = await nexusApi.createWorkspace(newName.trim());
      toast(result.message ?? "Workspace created.", result.status === "error" ? "err" : "ok");
      setNewName("");
      setCreating(false);
      onChanged();
      onSelect(newName.trim());
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    }
  };

  return (
    <div className="nexus-repo-list">
      <div className="nexus-repo-list-head">
        <span className="note" style={{ flex: 1, padding: "6px 4px" }}>
          {names.length} workspace{names.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" variant={creating ? "sec" : "primary"} onClick={() => setCreating((value) => !value)}>
          {creating ? "Close" : "+ Create"}
        </Button>
      </div>

      {creating && (
        <div className="ai-card nexus-add-repo-panel">
          <div className="row" style={{ gap: 6 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Workspace name, e.g. SimpleMDG Stella" value={newName} onChange={(event) => setNewName(event.target.value)} />
            <Button size="sm" onClick={create} disabled={!newName.trim()}>
              Create
            </Button>
          </div>
        </div>
      )}

      <div className="nexus-repo-rows">
        {names.length === 0 ? (
          <div className="note faint" style={{ padding: 16 }}>
            No workspaces yet. Group related repositories (e.g. a frontend, a backend, and shared packages) into a workspace to see cross-repo relationships.
          </div>
        ) : (
          names.map((name) => (
            <div key={name} className={`nexus-repo-row${selectedName === name ? " active" : ""}`} onClick={() => onSelect(name)}>
              <div className="nexus-repo-row-main">
                <span className="nexus-repo-row-name">{name}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
