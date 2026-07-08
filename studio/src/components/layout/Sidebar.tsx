import { useState } from "react";
import { Icon } from "../common/Icon";
import { ConnectionNavigator } from "../connections/ConnectionNavigator";
import { ObjectExplorer } from "../explorer/ObjectExplorer";
import { QueryFileNavigator } from "../query-files/QueryFileNavigator";
import { QueryHistoryPanel } from "../query-files/QueryHistoryPanel";

const RAIL_SECTIONS: Array<{ id: string; icon: string; label: string }> = [
  { id: "connections", icon: "db", label: "Connections" },
  { id: "explorer", icon: "sch", label: "Object Explorer" },
  { id: "queries", icon: "sql", label: "Saved Queries" },
  { id: "history", icon: "history", label: "History" },
];

function SidebarSection({
  id,
  title,
  count,
  children,
  defaultCollapsed,
}: {
  id: string;
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}): React.ReactElement {
  const [collapsed, setCollapsed] = useState(Boolean(defaultCollapsed));

  return (
    <section className={`side-sec${collapsed ? " collapsed" : ""}`} id={`sec-${id}`}>
      <div className="side-head" onClick={() => setCollapsed((prev) => !prev)}>
        <span className="chev">{collapsed ? "▸" : "▾"}</span>
        <span className="h-title">{title}</span>
        {count !== undefined ? <span className="h-count">{count || ""}</span> : null}
      </div>
      <div className="side-body">{children}</div>
    </section>
  );
}

export function Sidebar({
  collapsed,
  onExpand,
  connectionCount,
  connectionSearch,
  onConnectionSearchChange,
  onOpenBtpWizard,
}: {
  collapsed: boolean;
  onExpand: () => void;
  connectionCount: number;
  connectionSearch: string;
  onConnectionSearchChange: (value: string) => void;
  onOpenBtpWizard: () => void;
}): React.ReactElement {
  if (collapsed) {
    return (
      <div className="sidebar-rail">
        {RAIL_SECTIONS.map((section) => (
          <button key={section.id} className="rail-btn" title={section.label} aria-label={section.label} onClick={onExpand}>
            <Icon name={section.icon} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <aside className="sidebar">
      <SidebarSection id="connections" title="Connections" count={connectionCount}>
        <ConnectionNavigator search={connectionSearch} onSearchChange={onConnectionSearchChange} onImportFromBtp={onOpenBtpWizard} />
      </SidebarSection>
      <SidebarSection id="explorer" title="Object Explorer">
        <ObjectExplorer />
      </SidebarSection>
      <SidebarSection id="queries" title="Saved Queries">
        <QueryFileNavigator />
      </SidebarSection>
      <SidebarSection id="history" title="History">
        <QueryHistoryPanel />
      </SidebarSection>
    </aside>
  );
}
