import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { BtpTargetSelector } from "../../../components/btp/BtpTargetSelector";
import { BtpAppSelector } from "../../../components/btp/BtpAppSelector";
import { useAsync } from "../../../hooks/useAsync";
import { studioApi } from "../../../api/studio-api-client";
import type { TCfTargetSummary } from "../../../api/studio-api-types";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TBtpServiceCredential, TODataEntityType, TODataFunctionImport, TXsuaaCandidate } from "../api/tool-studio-api-client";
import { EndpointCard } from "../components/EndpointCard";

/** Deployed CAP srv apps always carry this naming tell — same rule cds-service-discovery.ts's GitLab-side equivalent uses. */
const SRV_APP_NAME_RE = /-srv-|-srv$/i;

/**
 * CF's GoRouter drops an app's route registration once its running instance count hits 0 — a
 * request to a stopped app's own URL 404s at the platform layer itself ("Requested route ...
 * does not exist"), before it ever reaches the app (or this page's credential/CDS-discovery
 * logic). That reads exactly like a broken/misconfigured OData service unless it's called out
 * explicitly — `processes` (e.g. "web:0/1") is the more reliable signal since an app can be
 * requestedState=started but crashed with 0 actual instances up.
 */
function isAppActuallyRunning(app: { requestedState?: string; processes?: string } | undefined): boolean {
  if (!app) return false;
  const runningMatch = app.processes?.match(/(\d+)\/\d+/);
  if (runningMatch) return Number(runningMatch[1]) > 0;
  return (app.requestedState ?? "").toLowerCase() === "started";
}

type TEntityRow =
  | { kind: "set"; key: string; name: string; entityType: TODataEntityType | undefined }
  | { kind: "fn"; key: string; name: string; functionImport: TODataFunctionImport };

export function CheckApiExternalPage(): React.ReactElement {
  // Two explicit steps — CF org/space, then which of that space's running "-srv-" apps to test —
  // rather than one flat list merging both: a single account here can easily run 50+ such apps,
  // which made one combined list hard to search/scan through in practice.
  const [cfTarget, setCfTarget] = useState<TCfTargetSummary | undefined>();
  const [selectedAppName, setSelectedAppName] = useState<string | undefined>();

  const liveApps = useAsync((targetKey: string, refresh?: boolean) => studioApi.getBtpApps(targetKey, refresh));
  useEffect(() => {
    if (cfTarget) void liveApps.run(cfTarget.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget]);

  const selectedLiveApp = liveApps.data?.apps.find((app) => app.name === selectedAppName);
  const liveRoute = selectedLiveApp?.routes?.split(",")[0]?.trim();
  const [baseUrlOverride, setBaseUrlOverride] = useState("");
  useEffect(() => {
    setBaseUrlOverride("");
  }, [selectedAppName]);
  const baseUrl = liveRoute ? `https://${liveRoute}` : baseUrlOverride;

  const targetKey = cfTarget?.key ?? "";

  // --- Credential: one round trip, auto-resolved from the picked app (see
  // /api/tool/check-api/credential-for-app's doc) — no separate "which app do I detect xsuaa from"
  // step. Only genuinely ambiguous cases (>1 xsuaa candidate) need a click. ---
  const credentialCall = useAsync((tk: string, appName: string) => toolStudioApi.getCredentialForApp(tk, appName));
  const [credential, setCredential] = useState<TBtpServiceCredential | undefined>();
  const [ambiguousCandidates, setAmbiguousCandidates] = useState<TXsuaaCandidate[] | undefined>();
  const saveCredentialCall = useAsync((tk: string, appName: string, serviceName: string) => toolStudioApi.saveBtpCredential({ targetKey: tk, appName, serviceName }));

  useEffect(() => {
    setCredential(undefined);
    setAmbiguousCandidates(undefined);
    if (!selectedAppName) return;
    void credentialCall.run(targetKey, selectedAppName).then((result) => {
      if (result?.credential) setCredential(result.credential);
      else if (result?.candidates?.length) setAmbiguousCandidates(result.candidates);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAppName]);

  // --- CDS services for the picked app — tries the app's own live index first, falls back to a
  // GitLab source scan only if a Deploy Target happens to link this space (unchanged). ---
  const appServices = useAsync((tk: string, appName: string, credentialId: string | undefined, baseUrlArg: string | undefined, refresh?: boolean) =>
    toolStudioApi.getAppServices({ cfTargetKey: tk, appName, credentialId, baseUrl: baseUrlArg, refresh }),
  );
  useEffect(() => {
    if (selectedAppName) void appServices.run(targetKey, selectedAppName, credential?.id, baseUrl || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAppName, credential, baseUrl]);

  const [selectedServiceName, setSelectedServiceName] = useState("");
  useEffect(() => {
    const services = appServices.data?.services ?? [];
    setSelectedServiceName(services.length === 1 ? services[0].name : "");
  }, [appServices.data]);
  const selectedService = appServices.data?.services.find((service) => service.name === selectedServiceName);

  const [path, setPath] = useState("/");
  useEffect(() => {
    if (selectedService) setPath(selectedService.path);
  }, [selectedService]);

  // --- $metadata-driven endpoint list ---
  const metadata = useAsync((credentialId: string, baseUrlArg: string, servicePath: string) => toolStudioApi.getCheckApiMetadata(credentialId, baseUrlArg, servicePath));
  useEffect(() => {
    // `path` starts at "/" until a CDS service is actually chosen (or typed manually) — firing the
    // fetch against that placeholder produced a confusing "404" before the user had picked anything.
    if (credential && baseUrl && path && path !== "/") void metadata.run(credential.id, baseUrl, path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential, baseUrl, path]);

  const [entitySelection, setEntitySelection] = useState("");
  useEffect(() => {
    setEntitySelection("");
  }, [metadata.data]);

  const version = metadata.data?.version ?? "v2";

  // One dropdown to pick the entity set / function to work with, instead of listing every one of
  // them at once — a service can easily have dozens, which made a scrollable list of cards tedious
  // to work through. Only the picked one renders below, with its own query builder + response.
  const entityRows: TEntityRow[] = useMemo(() => {
    const sets: TEntityRow[] = (metadata.data?.entitySets ?? []).map((set) => ({
      kind: "set",
      key: `set:${set.name}`,
      name: set.name,
      entityType: metadata.data?.entityTypes[set.entityTypeName],
    }));
    const fns: TEntityRow[] = (metadata.data?.functionImports ?? []).map((fn) => ({ kind: "fn", key: `fn:${fn.name}`, name: fn.name, functionImport: fn }));
    return [...sets, ...fns];
  }, [metadata.data]);

  const entityOptions = useMemo(
    () =>
      entityRows.map((row) => ({
        value: row.key,
        label: row.name,
        meta: row.kind === "set" ? `SET · ${row.entityType?.properties.length ?? 0} field(s)` : `${row.functionImport.httpMethod} · ${row.functionImport.parameters.length} param(s)`,
      })),
    [entityRows],
  );

  const selectedRow = entityRows.find((row) => row.key === entitySelection);

  return (
    <div>
      <div className="ts-header">
        <h1>Check API External</h1>
        <p className="note">
          Pick a CF org/space, then a running service in it. Auth and the OData service path are then resolved
          automatically from that same app; pick an entity set or function import from the dropdown below to build a
          query (or fill its parameters) and try it, the same way a Swagger/OpenAPI docs page would.
        </p>
      </div>

      {!cfTarget ? (
        <div className="ts-card" style={{ maxWidth: 1100 }}>
          <div className="note" style={{ marginBottom: 8 }}>
            Select the CF org/space whose deployed services you want to test:
          </div>
          <BtpTargetSelector onSelect={setCfTarget} />
        </div>
      ) : !selectedAppName ? (
        <div className="ts-card" style={{ maxWidth: 1100 }}>
          <BtpAppSelector
            targetKey={cfTarget.key}
            targetLabel={`${cfTarget.org} / ${cfTarget.space} (${cfTarget.region})`}
            onSelect={setSelectedAppName}
            onBack={() => setCfTarget(undefined)}
            filter={(app) => SRV_APP_NAME_RE.test(app.name ?? "")}
            emptyMessage='No running "-srv-" apps found in this space.'
          />
        </div>
      ) : (
        <div className="ts-card" style={{ maxWidth: 1100 }}>
          <div className="field">
            <div className="row" style={{ alignItems: "baseline" }}>
              <label style={{ flex: 1, marginBottom: 0 }}>Server</label>
              <Button variant="ghost" size="sm" onClick={() => setSelectedAppName(undefined)}>
                Change app
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCfTarget(undefined);
                  setSelectedAppName(undefined);
                }}
              >
                Change org/space
              </Button>
            </div>
            <div className="note">
              {selectedAppName} · {cfTarget.org}/{cfTarget.space} ({cfTarget.region}){baseUrl ? ` · ${baseUrl}` : ""}
            </div>
          </div>

          {selectedLiveApp && !isAppActuallyRunning(selectedLiveApp) && (
            <div className="errbox" style={{ marginBottom: 12 }}>
              This app is not running ({selectedLiveApp.requestedState ?? "unknown state"}
              {selectedLiveApp.processes ? ` · ${selectedLiveApp.processes}` : ""}) — its route stops resolving once every instance is down, so every call below will fail with a Cloud
              Foundry routing 404 (not an OData/CDS problem) until it's started. Start it — e.g. from CF Log / Restart, or <code>cf start {selectedAppName}</code> — then come back and
              Rescan.
            </div>
          )}

          {!liveRoute && (
            <div className="field">
              <label>Base URL (this app has no bound route — enter it manually)</label>
              <input className="input" placeholder="https://simplemdg-srv-bp.cfapps.us10.hana.ondemand.com" value={baseUrlOverride} onChange={(event) => setBaseUrlOverride(event.target.value)} />
            </div>
          )}

          <div className="field">
            <label>Credential</label>
            {credentialCall.loading ? (
              <div className="note">
                <Spinner /> Resolving credential from {selectedAppName}'s bound services...
              </div>
            ) : credential ? (
              <div className="note">
                {credential.name} <span className="note">(auto-resolved)</span>
              </div>
            ) : ambiguousCandidates?.length ? (
              <div className="ts-card" style={{ marginTop: 8 }}>
                <div className="note" style={{ marginBottom: 8 }}>
                  Multiple xsuaa-shaped services found in {selectedAppName} — pick one:
                </div>
                <div className="wiz-body">
                  {ambiguousCandidates.map((candidate) => (
                    <div key={candidate.serviceName} className="trow">
                      <div className="trow-main">
                        <div className="trow-title">{candidate.serviceName}</div>
                        <div className="trow-meta">
                          {candidate.servicePlan ?? ""} · {candidate.url}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={saveCredentialCall.loading}
                        onClick={async () => {
                          const saved = await saveCredentialCall.run(targetKey, selectedAppName, candidate.serviceName);
                          if (saved?.credential) {
                            setCredential(saved.credential);
                            setAmbiguousCandidates(undefined);
                          }
                        }}
                      >
                        Use
                      </Button>
                    </div>
                  ))}
                </div>
                {saveCredentialCall.error && <div className="errbox" style={{ marginTop: 8 }}>{saveCredentialCall.error}</div>}
              </div>
            ) : credentialCall.error || credentialCall.data?.error ? (
              <div className="errbox">{credentialCall.error || credentialCall.data?.error}</div>
            ) : null}
          </div>

          <div className="field">
            <div className="row" style={{ marginBottom: 6, alignItems: "baseline" }}>
              <label style={{ flex: 1, marginBottom: 0 }}>
                CDS service
                {appServices.data?.source &&
                  ` (discovered ${
                    appServices.data.source === "live-index"
                      ? "live from the service itself"
                      : appServices.data.source === "known-pattern"
                        ? "from a known object-type service path"
                        : "via GitLab source scan"
                  })`}
              </label>
              <Button
                variant="sec"
                size="sm"
                disabled={appServices.loading}
                onClick={() => void appServices.run(targetKey, selectedAppName, credential?.id, baseUrl || undefined, true)}
              >
                {appServices.loading ? <Spinner /> : "⟳ Rescan"}
              </Button>
            </div>
            {appServices.loading ? (
              <EmptyState>
                <Spinner /> resolving OData path(s) for {selectedAppName}...
              </EmptyState>
            ) : appServices.error ? (
              <div className="errbox">{appServices.error}</div>
            ) : appServices.data?.error ? (
              // A missing GitLab-group link (or a live index that isn't exposed) is expected/normal
              // for some apps — shown as informational rather than an error.
              <div className="note">{appServices.data.error}</div>
            ) : appServices.data?.scanError ? (
              <div className="errbox">Found the repo but couldn't scan it (try again): {appServices.data.scanError}</div>
            ) : !appServices.data?.matched ? (
              <div className="note">No matching GitLab repo found for this app — enter the service path manually below.</div>
            ) : !appServices.data.services.length ? (
              <div className="note">No CDS services found in {appServices.data.pathWithNamespace} — enter the service path manually below.</div>
            ) : appServices.data.services.length > 1 ? (
              <SearchableSelect
                value={selectedServiceName}
                onChange={setSelectedServiceName}
                placeholder="Select a CDS service..."
                searchPlaceholder="Search services..."
                options={appServices.data.services.map((service) => ({ value: service.name, label: service.name, meta: service.path }))}
              />
            ) : (
              <div className="note">
                {appServices.data.services[0].name} ({appServices.data.services[0].path})
              </div>
            )}
          </div>

          <div className="field">
            <label>Service path</label>
            <input className="input" placeholder="/BusinessPartnerCommonService" value={path} onChange={(event) => setPath(event.target.value)} />
          </div>

          {credential && baseUrl && (
            <div style={{ marginTop: 4 }}>
              {metadata.loading ? (
                <EmptyState>
                  <Spinner /> fetching $metadata...
                </EmptyState>
              ) : metadata.error || metadata.data?.error ? (
                <div className="errbox">{metadata.error || metadata.data?.error}</div>
              ) : metadata.data ? (
                <>
                  <div className="note" style={{ marginBottom: 8 }}>
                    {metadata.data.version.toUpperCase()} service · {metadata.data.entitySets.length} entity set(s) · {metadata.data.functionImports.length} function import(s)
                  </div>

                  <div className="field">
                    <label>Entity set / function</label>
                    <SearchableSelect
                      value={entitySelection}
                      onChange={setEntitySelection}
                      placeholder="Select an entity set or function import..."
                      searchPlaceholder="Search entity sets / functions..."
                      options={entityOptions}
                    />
                  </div>

                  {selectedRow && (
                    <EndpointCard
                      key={selectedRow.key}
                      kind={selectedRow.kind}
                      name={selectedRow.name}
                      entityType={selectedRow.kind === "set" ? selectedRow.entityType : undefined}
                      functionImport={selectedRow.kind === "fn" ? selectedRow.functionImport : undefined}
                      version={version}
                      credentialId={credential.id}
                      baseUrl={baseUrl}
                      servicePath={path}
                    />
                  )}
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
