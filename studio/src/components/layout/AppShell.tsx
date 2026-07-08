import { useEffect, useState } from "react";
import { TopBar } from "./TopBar";
import { Sidebar } from "./Sidebar";
import { ResizablePanel } from "./ResizablePanel";
import { StatusBar } from "./StatusBar";
import { WorkspaceTabs } from "../workspace/WorkspaceTabs";
import { WelcomePage } from "../workspace/WelcomePage";
import { SqlConsoleTab } from "../sql/SqlConsoleTab";
import { DataGridTab } from "../data-grid/DataGridTab";
import { StructureTab } from "../data-grid/StructureTab";
import { CfLoginModal } from "../btp/CfLoginModal";
import { BtpImportWizard } from "../btp/BtpImportWizard";
import { NewConnectionModal } from "../connections/NewConnectionModal";
import { SettingsModal } from "../common/SettingsModal";
import { ToastStack } from "../common/Toast";
import { useStudioStore } from "../../state/studio-store";
import { useWorkspaceStore } from "../../state/workspace-store";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";

export function AppShell(): React.ReactElement {
  const { connections, activeConnectionId, loadConnections, refreshCfStatus } = useStudioStore();
  const { tabs, activeTabId, layout, setSidebarWidth, setSidebarCollapsed, openTab } = useWorkspaceStore();
  const [connectionSearch, setConnectionSearch] = useState("");
  const [showBtpWizard, setShowBtpWizard] = useState(false);
  const [showCfLogin, setShowCfLogin] = useState(false);
  const [showNewConnection, setShowNewConnection] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadConnections();
    refreshCfStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useKeyboardShortcuts([{ key: "b", ctrl: true, handler: () => setSidebarCollapsed(!layout.sidebarCollapsed) }]);

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${layout.sidebarWidth}px` } as React.CSSProperties}>
      <TopBar
        onImport={() => setShowBtpWizard(true)}
        onHome={() => openTab({ key: "welcome", kind: "welcome", title: "Welcome", id: "welcome", closable: false })}
        onSettings={() => setShowSettings(true)}
        onToggleSidebar={() => setSidebarCollapsed(!layout.sidebarCollapsed)}
        connectionSearch={connectionSearch}
        onConnectionSearchChange={setConnectionSearch}
      />
      <div className="main-layout">
        <Sidebar
          collapsed={layout.sidebarCollapsed}
          onExpand={() => setSidebarCollapsed(false)}
          connectionCount={connections.length}
          connectionSearch={connectionSearch}
          onConnectionSearchChange={setConnectionSearch}
          onOpenBtpWizard={() => setShowBtpWizard(true)}
        />
        {!layout.sidebarCollapsed ? <ResizablePanel width={layout.sidebarWidth} onWidthChange={setSidebarWidth} /> : null}
        <div className="workspace">
          <WorkspaceTabs />
          {tabs.map((tab) => (
            <div key={tab.id} style={{ display: tab.id === activeTabId ? "flex" : "none", flexDirection: "column", flex: 1, minHeight: 0 }}>
              {tab.kind === "welcome" ? (
                <WelcomePage
                  onImportFromBtp={() => setShowBtpWizard(true)}
                  onNewConnection={() => setShowNewConnection(true)}
                  onOpenSqlConsole={() => openTab({ key: `sql:${Date.now()}`, kind: "sql", title: "SQL Console", connectionId: activeConnectionId })}
                  onConnectToBtp={() => setShowCfLogin(true)}
                />
              ) : tab.kind === "sql" ? (
                <SqlConsoleTab tab={tab} />
              ) : tab.kind === "data-grid" ? (
                <DataGridTab tab={tab} />
              ) : (
                <StructureTab tab={tab} />
              )}
            </div>
          ))}
        </div>
      </div>
      <StatusBar />
      <ToastStack />
      {showBtpWizard ? <BtpImportWizard onClose={() => setShowBtpWizard(false)} onImported={() => undefined} /> : null}
      {showCfLogin ? <CfLoginModal onClose={() => setShowCfLogin(false)} onSuccess={() => setShowCfLogin(false)} /> : null}
      {showNewConnection ? <NewConnectionModal onClose={() => setShowNewConnection(false)} onCreated={() => loadConnections()} /> : null}
      {showSettings ? <SettingsModal onClose={() => setShowSettings(false)} /> : null}
    </div>
  );
}
