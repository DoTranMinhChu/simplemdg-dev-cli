import { EmptyState } from "../../../components/common/EmptyState";
import { JsonView } from "../../../components/common/JsonView";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

/** §9/§12/§38 — the full raw observation list, never truncated: the "never lose access to full content" escape hatch. */
export function RawView({ observations }: { observations: TAiObservation[] }): React.ReactElement {
  if (!observations.length) return <EmptyState>No observations recorded.</EmptyState>;
  return (
    <div className="raw-view">
      <JsonView value={observations} />
    </div>
  );
}
