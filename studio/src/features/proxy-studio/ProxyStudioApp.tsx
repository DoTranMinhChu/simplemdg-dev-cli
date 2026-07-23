import { useState } from "react";
import { StudioMark } from "../../components/common/StudioMark";
import { EnvironmentsPage } from "./pages/EnvironmentsPage";
import { QuickProxyPage } from "./pages/QuickProxyPage";

type TProxyStudioSection = "environments" | "quick-proxy";

type TNavItem = { id: TProxyStudioSection; label: string };

const NAV_ITEMS: TNavItem[] = [
  { id: "environments", label: "Environments" },
  { id: "quick-proxy", label: "Quick Proxy" },
];

export function ProxyStudioApp(): React.ReactElement {
  const [section, setSection] = useState<TProxyStudioSection>("environments");

  return (
    <div className="ts-shell">
      <nav className="ts-nav">
        <div className="ts-nav-brand">
          <StudioMark studio="proxy" />
          SimpleMDG Proxy Studio
        </div>
        {NAV_ITEMS.map((item) => (
          <button key={item.id} className={`ts-nav-item${section === item.id ? " active" : ""}`} onClick={() => setSection(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      <main className="ts-content">{section === "environments" ? <EnvironmentsPage /> : <QuickProxyPage />}</main>
    </div>
  );
}
