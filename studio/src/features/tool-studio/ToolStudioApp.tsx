import { useState } from "react";
import { EmptyState } from "../../components/common/EmptyState";
import { StudioMark } from "../../components/common/StudioMark";
import { TestConfigPage } from "./pages/TestConfigPage";
import { CfLogRestartPage } from "./pages/CfLogRestartPage";
import { CheckApiExternalPage } from "./pages/CheckApiExternalPage";
import { CpiQueuePage } from "./pages/CpiQueuePage";
import { JiraDeployInfoPage } from "./pages/JiraDeployInfoPage";
import { IncidentSearchPage } from "./pages/IncidentSearchPage";
import { DeployModelPage } from "./pages/DeployModelPage";
import { ObjectTypesPage } from "./pages/ObjectTypesPage";
import { NpmrcRegistryPage } from "./pages/NpmrcRegistryPage";
import { BtpCredentialsPage } from "./pages/BtpCredentialsPage";

type TToolStudioSection =
  | "deploy-model"
  | "check-api-external"
  | "jira-deploy-info"
  | "incident-search"
  | "test-config"
  | "cpi-queue"
  | "cf-log-restart"
  | "npmrc-registry"
  | "object-types"
  | "btp-credentials";

type TNavItem = { id: TToolStudioSection; label: string; ready: boolean };

const NAV_ITEMS: TNavItem[] = [
  { id: "deploy-model", label: "Deploy Model", ready: true },
  { id: "check-api-external", label: "Check API External", ready: true },
  { id: "test-config", label: "Test Config", ready: true },
  { id: "cpi-queue", label: "CPI Queue / Event Mesh", ready: true },
  { id: "cf-log-restart", label: "CF Log / Restart", ready: true },
  { id: "jira-deploy-info", label: "Jira Deploy Info", ready: true },
  { id: "incident-search", label: "Incident Search", ready: true },
  { id: "object-types", label: "Object Types", ready: true },
  { id: "npmrc-registry", label: "npmrc / Registry", ready: true },
  { id: "btp-credentials", label: "BTP Credentials", ready: true },
];

export function ToolStudioApp(): React.ReactElement {
  const [section, setSection] = useState<TToolStudioSection>("test-config");

  return (
    <div className="ts-shell">
      <nav className="ts-nav">
        <div className="ts-nav-brand">
          <StudioMark studio="tool" />
          SimpleMDG Tool Studio
        </div>
        <div className="ts-nav-group">MDG Deploy</div>
        {NAV_ITEMS.slice(0, 2).map((item) => (
          <NavButton key={item.id} item={item} active={section === item.id} onSelect={setSection} />
        ))}
        <div className="ts-nav-group">Operations</div>
        {NAV_ITEMS.slice(2, 7).map((item) => (
          <NavButton key={item.id} item={item} active={section === item.id} onSelect={setSection} />
        ))}
        <div className="ts-nav-group">Configuration</div>
        {NAV_ITEMS.slice(7).map((item) => (
          <NavButton key={item.id} item={item} active={section === item.id} onSelect={setSection} />
        ))}
      </nav>
      <main className="ts-content">
        {section === "test-config" ? (
          <TestConfigPage />
        ) : section === "cf-log-restart" ? (
          <CfLogRestartPage />
        ) : section === "check-api-external" ? (
          <CheckApiExternalPage />
        ) : section === "cpi-queue" ? (
          <CpiQueuePage />
        ) : section === "jira-deploy-info" ? (
          <JiraDeployInfoPage />
        ) : section === "incident-search" ? (
          <IncidentSearchPage />
        ) : section === "deploy-model" ? (
          <DeployModelPage />
        ) : section === "object-types" ? (
          <ObjectTypesPage />
        ) : section === "npmrc-registry" ? (
          <NpmrcRegistryPage />
        ) : section === "btp-credentials" ? (
          <BtpCredentialsPage />
        ) : (
          <EmptyState>
            <p>{NAV_ITEMS.find((item) => item.id === section)?.label} is not wired up yet.</p>
            <p className="note">This is part of the same Tool Studio port — see the project's Tool Studio plan for build order.</p>
          </EmptyState>
        )}
      </main>
    </div>
  );
}

function NavButton({ item, active, onSelect }: { item: TNavItem; active: boolean; onSelect: (id: TToolStudioSection) => void }): React.ReactElement {
  return (
    <button
      className={`ts-nav-item${active ? " active" : ""}${item.ready ? "" : " disabled"}`}
      onClick={() => onSelect(item.id)}
    >
      {item.label}
      {!item.ready && <span className="ts-badge-soon">soon</span>}
    </button>
  );
}
