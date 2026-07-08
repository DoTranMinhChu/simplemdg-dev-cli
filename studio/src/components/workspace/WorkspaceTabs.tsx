import { useEffect, useRef, useState } from "react";
import { Icon } from "../common/Icon";
import { ContextMenu, type TContextMenuState } from "../common/ContextMenu";
import { useWorkspaceStore, type TWorkspaceTab } from "../../state/workspace-store";

const TAB_ICONS: Record<string, string> = { welcome: "home", sql: "sql", "data-grid": "table2", metadata: "col" };

export function WorkspaceTabs(): React.ReactElement {
  const { tabs, activeTabId, switchTab, closeTab, closeOtherTabs, closeTabsToRight, duplicateTab, togglePinned, updateTab } = useWorkspaceStore();
  const barRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [contextMenu, setContextMenu] = useState<(TContextMenuState & { tab: TWorkspaceTab }) | null>(null);
  const [overflowMenu, setOverflowMenu] = useState<{ x: number; y: number } | null>(null);

  const ordered = [...tabs].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  useEffect(() => {
    const check = (): void => {
      const element = barRef.current;
      if (element) setOverflowing(element.scrollWidth > element.clientWidth + 1);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [tabs.length]);

  return (
    <div className="tabbar-row">
      <div className="tabbar" ref={barRef}>
        {ordered.map((tab) => (
          <div
            key={tab.id}
            className={`wtab${tab.id === activeTabId ? " active" : ""}${tab.pinned ? " pinned" : ""}`}
            onClick={() => switchTab(tab.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu({ x: event.clientX, y: event.clientY, tab, items: [] });
            }}
          >
            <span className={`t-ico${tab.pinned ? " pin" : ""}`}>
              <Icon name={tab.pinned ? "star" : TAB_ICONS[tab.kind] ?? "sql"} />
            </span>
            <span className="t-title" title={tab.title}>
              {tab.title}
            </span>
            {tab.dirty ? <span className="dot" /> : null}
            {tab.closable !== false ? (
              <span
                className="x"
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Icon name="x" />
              </span>
            ) : null}
          </div>
        ))}
      </div>
      {overflowing ? (
        <button
          className="tab-overflow-btn"
          title="More tabs"
          aria-label="More tabs"
          onClick={(event) => {
            const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
            setOverflowMenu({ x: rect.right, y: rect.bottom + 4 });
          }}
        >
          ⋯
        </button>
      ) : null}

      {contextMenu ? (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            { label: "Close", icon: "x", onClick: () => closeTab(contextMenu.tab.id) },
            { label: "Close Others", icon: "x", onClick: () => closeOtherTabs(contextMenu.tab.id) },
            { label: "Close Tabs to the Right", icon: "x", onClick: () => closeTabsToRight(contextMenu.tab.id) },
            { sep: true },
            { label: contextMenu.tab.pinned ? "Unpin Tab" : "Pin Tab", icon: "star", onClick: () => togglePinned(contextMenu.tab.id) },
            {
              label: "Rename Tab",
              icon: "gear",
              onClick: () => {
                const name = window.prompt("New tab name", contextMenu.tab.title);
                if (name) updateTab(contextMenu.tab.id, { title: name });
              },
            },
            { label: "Duplicate Tab", icon: "plus", onClick: () => duplicateTab(contextMenu.tab.id) },
          ]}
        />
      ) : null}

      {overflowMenu ? (
        <ContextMenu
          x={overflowMenu.x}
          y={overflowMenu.y}
          onClose={() => setOverflowMenu(null)}
          items={ordered.map((tab) => ({
            label: tab.title + (tab.dirty ? " •" : ""),
            icon: TAB_ICONS[tab.kind] ?? "sql",
            onClick: () => switchTab(tab.id),
          }))}
        />
      ) : null}
    </div>
  );
}
