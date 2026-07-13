import { AiStudioStoreProvider } from "./state/ai-studio-store";
import { AiStudioPage } from "./AiStudioPage";

export function AiApp(): React.ReactElement {
  return (
    <AiStudioStoreProvider>
      <AiStudioPage />
    </AiStudioStoreProvider>
  );
}
