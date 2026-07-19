import { Button } from "../../../../components/common/Button";

/**
 * Inline, non-blocking degradation banner — rendered ABOVE whatever content a
 * tab can still show, never in place of the whole page (product requirement:
 * a GitNexus problem in one area must never hide unrelated working features).
 */
export function NexusUnavailableBanner({ message, onRetry }: { message: string; onRetry?: () => void }): React.ReactElement {
  return (
    <div className="ai-card nexus-unavailable-banner">
      <span className="note">{message}</span>
      {onRetry ? (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
