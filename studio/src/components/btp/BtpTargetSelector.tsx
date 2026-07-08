import { useEffect, useState } from "react";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { Spinner } from "../common/Spinner";
import { studioApi } from "../../api/studio-api-client";
import { useStudioEvents } from "../../hooks/useStudioEvents";
import type { TCfTargetSummary, TGetBtpTargetsResponse } from "../../api/studio-api-types";

function cacheBadgeLabel(status: string | undefined): string {
  return status === "fresh" ? "Fresh" : status === "stale" ? "Stale" : status === "expired" ? "Expired" : "—";
}

function TargetRow({ target, active, onSelect, onToggleFavorite }: { target: TCfTargetSummary; active: boolean; onSelect: () => void; onToggleFavorite: () => void }): React.ReactElement {
  return (
    <div className={`trow${active ? " active" : ""}`} onClick={onSelect}>
      <div className="trow-icon">{target.isFavorite ? "★" : "○"}</div>
      <div className="trow-main">
        <div className="trow-title">
          {target.org}
          {target.space ? ` / ${target.space}` : ""}
        </div>
        <div className="trow-meta">
          {target.region}
          {target.cachedAppCount != null ? ` · ${target.cachedAppCount} apps` : ""}
        </div>
      </div>
      <div className="trow-right">
        {target.cacheStatus !== "missing" ? <span className={`cbadge ${target.cacheStatus}`}>{cacheBadgeLabel(target.cacheStatus)}</span> : null}
        {target.environment ? <span className={`ci-env ${target.environment}`}>{target.environment}</span> : null}
        <span
          className={`trow-fav${target.isFavorite ? " on" : ""}`}
          title={target.isFavorite ? "Remove favorite" : "Add favorite"}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite();
          }}
        >
          ★
        </span>
      </div>
    </div>
  );
}

export function BtpTargetSelector({ onSelect }: { onSelect: (target: TCfTargetSummary) => void }): React.ReactElement {
  const [data, setData] = useState<TGetBtpTargetsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = (): void => {
    studioApi
      .getBtpTargets()
      .then((response) => {
        setData(response);
        setError("");
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useStudioEvents((event) => {
    if (event.resource === "cf-apps" || event.resource === "cf-cross-region-targets") load();
  });

  const toggleFavorite = async (target: TCfTargetSummary): Promise<void> => {
    await studioApi.setBtpFavorite(target.key, !target.isFavorite);
    load();
  };

  const refresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await studioApi.refreshBtpTargets();
      load();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <EmptyState>
        <Spinner /> loading targets...
      </EmptyState>
    );
  }
  if (error) return <div className="errbox">{error}</div>;
  if (!data) return <EmptyState>No data.</EmptyState>;

  const lowerQ = search.toLowerCase();
  const matches = (target: TCfTargetSummary): boolean => !lowerQ || `${target.org} ${target.space} ${target.region} ${target.environment ?? ""}`.toLowerCase().includes(lowerQ);
  const favorites = data.favorites.filter(matches);
  const recent = data.recent.filter(matches).filter((target) => !favorites.some((favorite) => favorite.key === target.key));
  const shownKeys = new Set([...favorites, ...recent].map((target) => target.key));

  return (
    <div>
      <div className="row" style={{ marginBottom: 6, gap: 8, alignItems: "center" }}>
        <input className="input" style={{ flex: 1 }} placeholder="Search org / space / region..." value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="note" style={{ marginBottom: 8 }}>
        Cached {data.totalTargets} targets{data.lastUpdatedAgo ? ` · updated ${data.lastUpdatedAgo}` : ""}
      </div>
      <div className="wiz-body" style={{ maxHeight: 360, overflow: "auto" }}>
        {favorites.length ? (
          <>
            <div className="wiz-section-hdr">
              <span>★ Favorites</span>
              <span className="wiz-count">{favorites.length}</span>
            </div>
            {favorites.map((target) => (
              <TargetRow key={target.key} target={target} active={false} onSelect={() => onSelect(target)} onToggleFavorite={() => toggleFavorite(target)} />
            ))}
          </>
        ) : null}
        {recent.length ? (
          <>
            <div className="wiz-section-hdr">
              <span>◷ Recent</span>
              <span className="wiz-count">{recent.length}</span>
            </div>
            {recent.map((target) => (
              <TargetRow key={target.key} target={target} active={false} onSelect={() => onSelect(target)} onToggleFavorite={() => toggleFavorite(target)} />
            ))}
          </>
        ) : null}
        {data.regions.map((region) => {
          const items = (data.byRegion[region] ?? []).filter(matches).filter((target) => !shownKeys.has(target.key));
          if (!items.length) return null;
          return (
            <div key={region}>
              <div className="wiz-section-hdr">
                <span>🌍 {region}</span>
                <span className="wiz-count">{items.length}</span>
              </div>
              {items.map((target) => (
                <TargetRow key={target.key} target={target} active={false} onSelect={() => onSelect(target)} onToggleFavorite={() => toggleFavorite(target)} />
              ))}
            </div>
          );
        })}
        {!favorites.length && !recent.length && !data.regions.some((region) => (data.byRegion[region] ?? []).filter(matches).length) ? (
          <EmptyState>{lowerQ ? "No targets match your search." : "No cached targets found. Run: smdg cf apps"}</EmptyState>
        ) : null}
      </div>
      <div className="row right" style={{ marginTop: 8 }}>
        <Button variant="sec" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "⟳ Refresh all regions"}
        </Button>
      </div>
    </div>
  );
}
