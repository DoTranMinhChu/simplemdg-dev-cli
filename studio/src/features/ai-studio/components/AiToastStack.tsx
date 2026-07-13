import { createPortal } from "react-dom";
import { useAiStudioStore } from "../state/ai-studio-store";

export function AiToastStack(): React.ReactElement | null {
  const { toasts, dismissToast } = useAiStudioStore();
  const root = document.getElementById("overlay-root");
  if (!root) return null;

  return createPortal(
    <div className="toasts">
      {toasts.map((item) => (
        <div key={item.id} className={`toast ${item.kind}`} onClick={() => dismissToast(item.id)}>
          {item.message}
        </div>
      ))}
    </div>,
    root,
  );
}
