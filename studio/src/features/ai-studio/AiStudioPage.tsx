import { useEffect, useState } from "react";
import { AiToastStack } from "./components/AiToastStack";
import { AiNavigationRail } from "./components/layout/AiNavigationRail";
import { CommandPalette } from "./components/CommandPalette";
import { AiOverviewPage } from "./pages/AiOverviewPage";
import { AiSessionsPage } from "./pages/AiSessionsPage";
import { AiProjectsPage } from "./pages/AiProjectsPage";
import { AiDoctorPage } from "./pages/AiDoctorPage";
import { isNavRailCollapsed, setNavRailCollapsed } from "./nav-rail-collapsed";
import { useAiStudioStore } from "./state/ai-studio-store";

export function AiStudioPage(): React.ReactElement {
  const { currentPage, setCurrentPage } = useAiStudioStore();
  const [collapsed, setCollapsed] = useState(isNavRailCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "P" || event.key === "p")) {
        event.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleCollapsed = (): void => {
    setCollapsed((prev) => {
      const next = !prev;
      setNavRailCollapsed(next);
      return next;
    });
  };

  return (
    <div className="app-shell ai-studio-shell">
      <header className="topbar">
        <span className="brand">
          SimpleMDG <span className="b2">AI Studio</span>
        </span>
        <span className="grow" />
        <button type="button" className="ai-palette-hint-btn" onClick={() => setPaletteOpen(true)} title="Command palette (Ctrl+Shift+P)">
          Ctrl+Shift+P
        </button>
        <span className="note faint">Local only · 127.0.0.1</span>
      </header>
      <div className="main-layout ai-shell-layout">
        <AiNavigationRail currentPage={currentPage} onSelectPage={setCurrentPage} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
        <div className="ai-page-area">
          {currentPage === "overview" ? (
            <AiOverviewPage />
          ) : currentPage === "projects" ? (
            <AiProjectsPage />
          ) : currentPage === "doctor" ? (
            <AiDoctorPage />
          ) : (
            <AiSessionsPage />
          )}
        </div>
      </div>
      <footer className="statusbar">
        <span className="st-item faint">Sessions and observations never leave this machine. Secrets are redacted by default.</span>
      </footer>
      <AiToastStack />
      {paletteOpen ? <CommandPalette onClose={() => setPaletteOpen(false)} /> : null}
    </div>
  );
}
