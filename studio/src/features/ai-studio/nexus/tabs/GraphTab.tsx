import { useEffect, useState } from "react";
import { EmptyState } from "../../../../components/common/EmptyState";
import { nexusApi } from "../../../../api/nexus-api-client";
import type { TNexusRepoSummary } from "../../../../api/nexus-api-types";
import { NexusUnavailableBanner } from "../components/NexusUnavailableBanner";

/**
 * GitNexus's own full graph explorer, embedded and deep-linked to this
 * specific repo via its `?project=<name>` URL param (confirmed by inspecting
 * its bundle) — skips its own "choose a repository" screen. This is now the
 * primary way to explore a repo's structure/relationships interactively;
 * this product's own Search tab was removed after repeated real search
 * failures traced to GitNexus's full-text-search extension reporting
 * "unavailable" on this platform (`.gitnexus/meta.json`'s `capabilities.fts`)
 * — a native-extension limitation outside this integration's control.
 */
export function GraphTab({ repo }: { repo: TNexusRepoSummary }): React.ReactElement {
  const [url, setUrl] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    nexusApi
      .openAdvancedGraphView()
      .then((result) => {
        if (cancelled) return;
        if (result.status === "error" || !result.url) {
          setError(result.message ?? "Couldn't start GitNexus's graph explorer.");
          return;
        }
        setUrl(`${result.url}/?project=${encodeURIComponent(repo.name)}`);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [repo.name]);

  if (loading) {
    return (
      <EmptyState>
        <span className="spin" /> Starting GitNexus's graph explorer...
      </EmptyState>
    );
  }

  if (error || !url) {
    return <NexusUnavailableBanner message={error ?? "Graph view isn't available right now."} />;
  }

  return <iframe src={url} title="GitNexus graph explorer" className="nexus-graph-frame-tab" />;
}
