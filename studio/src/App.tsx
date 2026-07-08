import { StudioStoreProvider } from "./state/studio-store";
import { WorkspaceStoreProvider } from "./state/workspace-store";
import { AppShell } from "./components/layout/AppShell";

export function App(): React.ReactElement {
  return (
    <StudioStoreProvider>
      <WorkspaceStoreProvider>
        <AppShell />
      </WorkspaceStoreProvider>
    </StudioStoreProvider>
  );
}
