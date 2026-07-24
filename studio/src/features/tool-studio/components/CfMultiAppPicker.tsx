import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { EmptyState } from "../../../components/common/EmptyState";
import { Spinner } from "../../../components/common/Spinner";
import { studioApi } from "../../../api/studio-api-client";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCloudFoundryApp } from "../../../api/studio-api-types";

/**
 * Multi-select app checklist for CF Log/Restart — pick several apps at once and see their logs as
 * tabs (the legacy tool's UI; `DEFAULT_CF_LOG_RESTART_APPS` on the server carries over its default
 * app-name-suffix list). Apps ending in one of those suffixes are pre-checked as a starting point,
 * fully overridable — some spaces don't have every one of those services, or use different names.
 */
export function CfMultiAppPicker({
  targetKey,
  targetLabel,
  onConfirm,
  onBack,
  initialSelected,
  showTargetsCrumb = true,
  confirmLabel = "Get logs",
  backLabel = "◁ Back",
}: {
  targetKey: string;
  targetLabel: string;
  onConfirm: (appNames: string[]) => void;
  onBack: () => void;
  /** Pre-checks these apps instead of matching DEFAULT_CF_LOG_RESTART_APPS suffixes — used when
   * adding more apps to an already-open set of tabs, so the ones already open stay checked. */
  initialSelected?: string[];
  showTargetsCrumb?: boolean;
  confirmLabel?: string;
  backLabel?: string;
}): React.ReactElement {
  const [apps, setApps] = useState<TCloudFoundryApp[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [defaultsApplied, setDefaultsApplied] = useState(Boolean(initialSelected));

  const load = (refresh = false): void => {
    setLoading(true);
    studioApi
      .getBtpApps(targetKey, refresh)
      .then((response) => {
        if (response.error && !response.apps?.length) {
          setError(response.error);
          setApps([]);
        } else {
          setError("");
          setApps(response.apps ?? []);
        }
      })
      .catch((fetchError) => setError(fetchError instanceof Error ? fetchError.message : String(fetchError)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  useEffect(() => {
    if (!apps || defaultsApplied) return;
    setDefaultsApplied(true);
    toolStudioApi
      .getCfLogRestartDefaults()
      .then((response) => {
        const suffixes = response.appNames ?? [];
        const matched = apps.filter((app) => suffixes.some((suffix) => app.name.endsWith(suffix)));
        if (matched.length) setSelected(new Set(matched.map((app) => app.name)));
      })
      .catch(() => undefined);
  }, [apps, defaultsApplied]);

  const toggle = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const lowerQ = search.toLowerCase();
  const filtered = (apps ?? []).filter((app) => (app.name ?? "").toLowerCase().includes(lowerQ));

  // Selected apps float to the top so it's obvious at a glance what's already picked, instead of
  // making the user scan the whole (potentially long) list for checked boxes. `.sort` is a stable
  // sort (guaranteed since ES2019), so within each group the original list order is preserved.
  const sorted = useMemo(
    () => [...filtered].sort((a, b) => Number(selected.has(b.name)) - Number(selected.has(a.name))),
    [filtered, selected],
  );

  return (
    <div>
      <div className="wiz-breadcrumb" style={{ marginBottom: 8 }}>
        {showTargetsCrumb && (
          <>
            <span className="crumb" onClick={onBack}>
              Targets
            </span>
            <span className="sep"> › </span>
          </>
        )}
        <span>{targetLabel}</span>
      </div>

      {loading ? (
        <EmptyState>
          <Spinner /> loading apps from {targetLabel}...
        </EmptyState>
      ) : error ? (
        <>
          <div className="errbox">{error}</div>
          <div className="row right" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={onBack}>
              {backLabel}
            </Button>
            <Button variant="sec" onClick={() => load(true)}>
              ⟳ Retry
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8, gap: 8 }}>
            <input className="input" style={{ flex: 1 }} placeholder="Search apps..." value={search} onChange={(event) => setSearch(event.target.value)} />
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(filtered.map((app) => app.name)))}>
              Select all
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
          <div className="wiz-body" style={{ maxHeight: 340, overflow: "auto" }}>
            {!sorted.length ? (
              <EmptyState>{search ? "No apps match your search." : "No apps found in this space."}</EmptyState>
            ) : (
              sorted.map((app) => (
                <label key={app.name} className={`trow${selected.has(app.name) ? " active" : ""}`} style={{ cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(app.name)} onChange={() => toggle(app.name)} style={{ marginRight: 8 }} />
                  <div className="trow-main">
                    <div className="trow-title">{app.name}</div>
                    <div className="trow-meta">
                      {app.requestedState ?? ""}
                      {app.processes ? ` · ${app.processes}` : ""}
                    </div>
                  </div>
                </label>
              ))
            )}
          </div>
          <div className="row right" style={{ marginTop: 8 }}>
            <Button variant="ghost" onClick={onBack}>
              {backLabel}
            </Button>
            <Button onClick={() => onConfirm([...selected])} disabled={!selected.size}>
              {confirmLabel} ({selected.size})
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
