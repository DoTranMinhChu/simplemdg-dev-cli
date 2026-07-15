import { useEffect, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchInput } from "../../../components/common/SearchInput";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { pluginsApi } from "../../../api/plugins-api-client";
import { useAiStudioStore } from "../../ai-studio/state/ai-studio-store";
import { getRememberedProjectRoot, rememberProjectRoot } from "../plugins-project-root";
import { InstallPlanDialog } from "./InstallPlanDialog";
import { PluginDetailPanel } from "./PluginDetailPanel";
import type { TProjectOption } from "../../../api/ai-studio-api-client";
import type { TInstallScope, TPluginCatalogEntry } from "../../../api/plugins-api-types";

const PROJECT_ROOT_DATALIST_ID = "plugin-project-root-options";

function kindLabel(kind: string): string {
  if (kind === "agent") return "Agent";
  if (kind === "skill") return "Skill";
  return "MCP bundle";
}

/** Browse/install/manage plugins bundled with this CLI — the AI Studio counterpart to `smdg plugin ...`. */
export function PluginsCatalogPage(): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [projectRoot, setProjectRoot] = useState(getRememberedProjectRoot);
  const [catalog, setCatalog] = useState<TPluginCatalogEntry[] | undefined>();
  const [knownProjects, setKnownProjects] = useState<TProjectOption[]>([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [installIds, setInstallIds] = useState<string[] | undefined>();
  const [installScope, setInstallScope] = useState<TInstallScope>("user");

  const load = (): void => {
    pluginsApi
      .list(projectRoot || undefined)
      .then((response) => setCatalog(response.plugins))
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "err"));
  };

  useEffect(load, [projectRoot]);

  // Suggestions only — reuses the project list AI Studio already derives from ingested Claude
  // Code / Codex session logs (same source as the "Projects" page), so the user can pick a known
  // project instead of having to remember and type its exact path. Doesn't limit what can be
  // typed: a project with no Claude Code session yet still works via free text.
  useEffect(() => {
    aiStudioApi
      .getProjects()
      .then((response) => setKnownProjects(response.projects))
      .catch(() => undefined);
  }, []);

  const onProjectRootChange = (value: string): void => {
    setProjectRoot(value);
    rememberProjectRoot(value);
  };

  const filtered = (catalog ?? []).filter((entry) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;
    return entry.manifest.id.toLowerCase().includes(query) || entry.manifest.displayName.toLowerCase().includes(query) || entry.manifest.description.toLowerCase().includes(query);
  });

  const selected = selectedId ? (catalog ?? []).find((entry) => entry.manifest.id === selectedId) : undefined;

  if (selected) {
    return (
      <>
        <PluginDetailPanel
          entry={selected}
          projectRoot={projectRoot}
          onBack={() => setSelectedId(undefined)}
          onInstall={(scope) => {
            setInstallScope(scope);
            setInstallIds([selected.manifest.id]);
          }}
          onChanged={load}
        />
        {installIds ? (
          <InstallPlanDialog
            ids={installIds}
            scope={installScope}
            projectRoot={projectRoot}
            onClose={() => setInstallIds(undefined)}
            onInstalled={() => {
              setInstallIds(undefined);
              load();
            }}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="ai-page">
      <div className="ai-page-head">
        <h1>Plugins</h1>
        <div className="lede">Install Claude Code agents, skills, and MCP bundles bundled with this CLI. Dependencies resolve automatically.</div>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          className="input"
          value={projectRoot}
          onChange={(event) => onProjectRootChange(event.target.value)}
          placeholder="Project path for project-scope installs and the Evidence Explorer (optional)"
          list={PROJECT_ROOT_DATALIST_ID}
          style={{ flex: "1 1 380px", minWidth: 260, width: "auto" }}
        />
        <datalist id={PROJECT_ROOT_DATALIST_ID}>
          {knownProjects.map((option) => (
            <option key={option.cwd} value={option.cwd} label={option.project} />
          ))}
        </datalist>
        <SearchInput value={search} onChange={setSearch} placeholder="Search plugins..." className="ai-page-search" />
      </div>

      {!catalog ? (
        <EmptyState>
          <span className="spin" /> loading plugins...
        </EmptyState>
      ) : !filtered.length ? (
        <EmptyState>{search ? "No plugins match." : "No plugins found in the bundled registry."}</EmptyState>
      ) : (
        <div className="plugin-list">
          {filtered.map((entry) => (
            <button key={entry.manifest.id} type="button" className="ai-card plugin-card" onClick={() => setSelectedId(entry.manifest.id)}>
              <div className="plugin-card-head">
                <div className="plugin-card-title">
                  <div style={{ fontWeight: 600 }}>{entry.manifest.displayName}</div>
                  <div className="note">{entry.manifest.id}</div>
                </div>
                <span className="badge">{kindLabel(entry.manifest.kind)}</span>
              </div>
              <div className="plugin-card-desc">{entry.manifest.description}</div>
              <div className="plugin-card-footer">
                {entry.manifest.dependsOn.length ? (
                  <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
                    {entry.manifest.dependsOn.map((dependencyId) => (
                      <span key={dependencyId} className="chip">
                        {dependencyId}
                      </span>
                    ))}
                  </div>
                ) : null}
                {entry.installed ? (
                  <div className="note" style={{ color: "var(--green)" }}>
                    Installed ({entry.installed.scope} scope, v{entry.installed.version})
                    {entry.installed.version !== entry.manifest.version ? (
                      <span style={{ color: "var(--amber)" }}> — update available (v{entry.manifest.version})</span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
