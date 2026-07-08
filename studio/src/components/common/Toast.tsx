import { createPortal } from "react-dom";
import { useStudioStore } from "../../state/studio-store";

export function ToastStack(): React.ReactElement | null {
  const { toasts, dismissToast } = useStudioStore();
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
