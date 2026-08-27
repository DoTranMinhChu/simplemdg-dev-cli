import { lazy, Suspense, useEffect, useState } from "react";
import { EmptyState } from "../../components/common/EmptyState";
import { StudioMark } from "../../components/common/StudioMark";
import { Spinner } from "../../components/common/Spinner";
import { IconButton } from "../../components/common/IconButton";
import { ConnectionStatusRow } from "./components/ConnectionStatusRow";
import { ToolAuthStatusProvider } from "./state/tool-auth-status";
import { TestConfigPage } from "./pages/TestConfigPage";
import { CfLogRestartPage } from "./pages/CfLogRestartPage";
import { CheckApiExternalPage } from "./pages/CheckApiExternalPage";
import { CpiQueuePage } from "./pages/CpiQueuePage";
import { JiraDeployInfoPage } from "./pages/JiraDeployInfoPage";
import { IncidentSearchPage } from "./pages/IncidentSearchPage";
import { DeployModelPage } from "./pages/DeployModelPage";
import { MoveModelPage } from "./pages/MoveModelPage";
import { CdsBulkUpgradePage } from "./pages/CdsBulkUpgradePage";
import { ObjectTypesPage } from "./pages/ObjectTypesPage";
import { NpmrcRegistryPage } from "./pages/NpmrcRegistryPage";
import { BtpCredentialsPage } from "./pages/BtpCredentialsPage";
import { AuditLogPage } from "./pages/AuditLogPage";

// Fortune-sheet/TipTap/docx/mammoth/exceljs together add several MB — code-split so that weight
// only downloads for someone who actually opens File Editor, not on every Tool Studio page load.
const FileEditorPage = lazy(() => import("./pages/FileEditorPage").then((mod) => ({ default: mod.FileEditorPage })));

type TToolStudioSection =
  | "deploy-model"
  | "move-model"
  | "cds-bulk-upgrade"
  | "check-api-external"
  | "jira-deploy-info"
  | "incident-search"
  | "test-config"
  | "cpi-queue"
  | "cf-log-restart"
  | "audit-log-monitor"
  | "npmrc-registry"
  | "object-types"
  | "btp-credentials"
  | "file-editor";

type TNavItem = { id: TToolStudioSection; label: string; ready: boolean };

const NAV_ITEMS: TNavItem[] = [
  { id: "deploy-model", label: "Deploy Model", ready: true },
  { id: "move-model", label: "Move Model", ready: true },
  { id: "cds-bulk-upgrade", label: "Upgrade CDS Version", ready: true },
  { id: "check-api-external", label: "Check API External", ready: true },
  { id: "test-config", label: "Test Config", ready: true },
  { id: "cpi-queue", label: "CPI Queue / Event Mesh", ready: true },
  { id: "cf-log-restart", label: "CF Log / Restart", ready: true },
  { id: "audit-log-monitor", label: "Audit Log Monitor", ready: true },
  { id: "jira-deploy-info", label: "Jira Deploy Info", ready: true },
  { id: "incident-search", label: "Incident Search", ready: true },
  { id: "file-editor", label: "File Editor", ready: true },
  { id: "object-types", label: "Object Types", ready: true },
  { id: "npmrc-registry", label: "npmrc / Registry", ready: true },
  { id: "btp-credentials", label: "BTP Credentials", ready: true },
];

const DEFAULT_SECTION: TToolStudioSection = "test-config";

/** Every page component, keyed by nav id — looked up once per visited section, never re-created. */
const PAGE_COMPONENTS: Partial<Record<TToolStudioSection, React.ComponentType>> = {
  "test-config": TestConfigPage,
  "cf-log-restart": CfLogRestartPage,
  "audit-log-monitor": AuditLogPage,
  "check-api-external": CheckApiExternalPage,
  "cpi-queue": CpiQueuePage,
  "jira-deploy-info": JiraDeployInfoPage,
  "incident-search": IncidentSearchPage,
  "file-editor": FileEditorPage,
  "deploy-model": DeployModelPage,
  "move-model": MoveModelPage,
  "cds-bulk-upgrade": CdsBulkUpgradePage,
  "object-types": ObjectTypesPage,
  "npmrc-registry": NpmrcRegistryPage,
  "btp-credentials": BtpCredentialsPage,
};

function sectionFromHash(): TToolStudioSection | undefined {
  const id = window.location.hash.replace(/^#/, "");
  return NAV_ITEMS.some((item) => item.id === id) ? (id as TToolStudioSection) : undefined;
}

const NAV_COLLAPSED_STORAGE_KEY = "ts-nav-collapsed";

export function ToolStudioApp(): React.ReactElement {
  const [section, setSection] = useState<TToolStudioSection>(() => sectionFromHash() ?? DEFAULT_SECTION);
  // Persisted so a wide-content page (e.g. File Editor's spreadsheet grid) stays collapsed across
  // reloads and hash navigation instead of resetting every time.
  const [navCollapsed, setNavCollapsed] = useState<boolean>(() => localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "1");

  const toggleNavCollapsed = (): void => {
    setNavCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
      return next;
    });
    // Canvas-based content (e.g. File Editor's spreadsheet grid) sizes itself off its container's
    // measured width at mount and doesn't watch for the CSS grid-column transition below — nudge it
    // to re-measure once the transition finishes, or it leaves the freed-up space empty.
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
  };
  // Every section that's ever been shown stays mounted (hidden via CSS) from then on, so switching
  // away and back never loses a selection, a scan result, or an in-flight request's progress.
  const [visited, setVisited] = useState<Set<TToolStudioSection>>(() => new Set([section]));

  useEffect(() => {
    setVisited((prev) => (prev.has(section) ? prev : new Set(prev).add(section)));
  }, [section]);

  // Covers every way `section` can change: a nav-item click (native hash navigation), typing a URL,
  // opening a bookmark, or the browser's Back/Forward buttons walking hash history.
  useEffect(() => {
    const onHashChange = (): void => {
      const next = sectionFromHash();
      if (next) setSection(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <ToolAuthStatusProvider>
    <div className={`ts-shell${navCollapsed ? " nav-collapsed" : ""}`}>
      <nav className="ts-nav">
        <IconButton
          className="ts-nav-toggle"
          icon={navCollapsed ? "chevR" : "chevL"}
          label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={toggleNavCollapsed}
        />
        {!navCollapsed && (
          <>
            <div className="ts-nav-brand">
              <StudioMark studio="tool" />
              SimpleMDG Tool Studio
            </div>
            <ConnectionStatusRow />
            <div className="ts-nav-group">MDG Deploy</div>
            {NAV_ITEMS.slice(0, 4).map((item) => (
              <NavButton key={item.id} item={item} active={section === item.id} />
            ))}
            <div className="ts-nav-group">Operations</div>
            {NAV_ITEMS.slice(4, 11).map((item) => (
              <NavButton key={item.id} item={item} active={section === item.id} />
            ))}
            <div className="ts-nav-group">Configuration</div>
            {NAV_ITEMS.slice(10).map((item) => (
              <NavButton key={item.id} item={item} active={section === item.id} />
            ))}
          </>
        )}
      </nav>
      <main className="ts-content">
        <Suspense fallback={<Spinner />}>
          {Array.from(visited).map((id) => {
            const Component = PAGE_COMPONENTS[id];
            return (
              <div key={id} style={{ display: section === id ? "block" : "none" }}>
                {Component ? (
                  <Component />
                ) : (
                  <EmptyState>
                    <p>{NAV_ITEMS.find((item) => item.id === id)?.label} is not wired up yet.</p>
                    <p className="note">This is part of the same Tool Studio port — see the project's Tool Studio plan for build order.</p>
                  </EmptyState>
                )}
              </div>
            );
          })}
        </Suspense>
      </main>
    </div>
    </ToolAuthStatusProvider>
  );
}

function NavButton({ item, active }: { item: TNavItem; active: boolean }): React.ReactElement {
  return (
    <a href={`#${item.id}`} className={`ts-nav-item${active ? " active" : ""}${item.ready ? "" : " disabled"}`}>
      {item.label}
      {!item.ready && <span className="ts-badge-soon">soon</span>}
    </a>
  );
}
