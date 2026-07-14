import { useEffect, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchInput } from "../../../components/common/SearchInput";
import { aiStudioApi, type TProjectOption } from "../../../api/ai-studio-api-client";
import { useAiStudioStore } from "../state/ai-studio-store";

/** Every project with a session count and a one-click way into its filtered session list — the same data ProjectPicker uses, as a browsable page instead of a small popover. */
export function AiProjectsPage(): React.ReactElement {
  const { setFilter, setCurrentPage } = useAiStudioStore();
  const [projects, setProjects] = useState<TProjectOption[] | undefined>();
  const [search, setSearch] = useState("");

  useEffect(() => {
    aiStudioApi
      .getProjects()
      .then((response) => setProjects(response.projects))
      .catch(() => setProjects([]));
  }, []);

  /** Filters by `cwd`, not the display name — two projects can share a folder basename (see ai-session-store.ts's listProjects) and must still open independently. */
  const openProject = (cwd: string): void => {
    setFilter({ cwd, project: undefined });
    setCurrentPage("sessions");
  };

  const filtered = (projects ?? []).filter((option) => option.project.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="ai-page">
      <div className="ai-page-head">
        <h1>Projects</h1>
        <div className="lede">Every project with at least one ingested session.</div>
      </div>

      <SearchInput value={search} onChange={setSearch} placeholder="Search projects..." className="ai-page-search" />

      {!projects ? (
        <EmptyState>
          <span className="spin" /> loading projects...
        </EmptyState>
      ) : !filtered.length ? (
        <EmptyState>{search ? "No projects match." : "No projects found yet."}</EmptyState>
      ) : (
        <div className="ai-project-grid">
          {filtered.map((option) => (
            <button key={option.cwd} type="button" className="ai-project-card" onClick={() => openProject(option.cwd)} title={option.cwd}>
              <span className="ai-project-card-name">{option.project}</span>
              <span className="ai-project-card-count">
                {option.sessionCount} session{option.sessionCount === 1 ? "" : "s"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
