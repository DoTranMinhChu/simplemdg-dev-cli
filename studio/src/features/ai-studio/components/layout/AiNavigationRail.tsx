import { Icon } from "../../../../components/common/Icon";
import type { TAiPage } from "../../state/ai-studio-store";

const NAV_ITEMS: Array<{ page: TAiPage; label: string; icon: string }> = [
  { page: "overview", label: "Overview", icon: "home" },
  { page: "sessions", label: "Sessions", icon: "history" },
  { page: "nexus", label: "Code Intelligence", icon: "map" },
  { page: "projects", label: "Projects", icon: "fld" },
  { page: "doctor", label: "Doctor", icon: "activity" },
  { page: "plugins", label: "Plugins", icon: "plug" },
];

/** Primary navigation rail — icon-only when collapsed, icon+label expanded. Collapsed state persists across visits (nav-rail-collapsed.ts). */
export function AiNavigationRail({
  currentPage,
  onSelectPage,
  collapsed,
  onToggleCollapsed,
}: {
  currentPage: TAiPage;
  onSelectPage: (page: TAiPage) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}): React.ReactElement {
  return (
    <nav className={`ai-nav-rail${collapsed ? " collapsed" : ""}`}>
      <div className="ai-nav-items">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            type="button"
            className={`ai-nav-item${currentPage === item.page ? " active" : ""}`}
            title={collapsed ? item.label : undefined}
            onClick={() => onSelectPage(item.page)}
          >
            <Icon name={item.icon} className="ai-nav-icon" />
            {collapsed ? null : <span className="ai-nav-label">{item.label}</span>}
          </button>
        ))}
      </div>
      <button type="button" className="ai-nav-toggle" title={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={onToggleCollapsed}>
        <Icon name="panel" className="ai-nav-icon" />
        {collapsed ? null : <span className="ai-nav-label">Collapse</span>}
      </button>
    </nav>
  );
}
