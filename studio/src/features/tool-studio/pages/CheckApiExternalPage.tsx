import { useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { BtpTargetSelector } from "../../../components/btp/BtpTargetSelector";
import { BtpAppSelector } from "../../../components/btp/BtpAppSelector";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TBtpServiceCredential, TODataEntityType } from "../api/tool-studio-api-client";
import { studioApi } from "../../../api/studio-api-client";
import type { TCfTargetSummary } from "../../../api/studio-api-types";

/** Deployed CAP srv apps always carry this naming tell — `-srv-` or a trailing `-srv` — same rule used GitLab-side in cds-service-discovery.ts, applied here to live `cf apps` names instead of repo names. */
const SRV_APP_NAME_RE = /-srv-|-srv$/i;

const FILTER_OPERATORS = [
  { value: "eq", label: "= (eq)" },
  { value: "ne", label: "≠ (ne)" },
  { value: "gt", label: "> (gt)" },
  { value: "ge", label: "≥ (ge)" },
  { value: "lt", label: "< (lt)" },
  { value: "le", label: "≤ (le)" },
  { value: "contains", label: "contains" },
  { value: "startswith", label: "starts with" },
  { value: "endswith", label: "ends with" },
];

function isNumericEdmType(type: string): boolean {
  return /^Edm\.(Byte|SByte|Int16|Int32|Int64|Single|Double|Decimal)$/.test(type);
}

function formatFilterValue(rawValue: string, propType: string | undefined): string {
  if (!propType || isNumericEdmType(propType) || propType === "Edm.Boolean") return rawValue;
  if (propType === "Edm.Guid") return `guid'${rawValue}'`;
  return `'${rawValue.replace(/'/g, "''")}'`;
}

function buildFilterClause(property: string, operator: string, rawValue: string, propType: string | undefined, version: "v2" | "v4"): string {
  const value = formatFilterValue(rawValue, propType);
  switch (operator) {
    case "contains":
      return version === "v2" ? `substringof(${value},${property})` : `contains(${property},${value})`;
    case "startswith":
      return `startswith(${property},${value})`;
    case "endswith":
      return `endswith(${property},${value})`;
    default:
      return `${property} ${operator} ${value}`;
  }
}

function toggleInSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Checkbox list for $select/$expand — plain scrollable box, no search needed at typical entity-property counts. */
function CheckboxList({ items, selected, onToggle }: { items: string[]; selected: Set<string>; onToggle: (value: string) => void }): React.ReactElement {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, maxHeight: 180, overflow: "auto", padding: 8 }}>
      {items.length ? (
        items.map((item) => (
          <label key={item} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0", cursor: "pointer" }}>
            <input type="checkbox" checked={selected.has(item)} onChange={() => onToggle(item)} />
            <span>{item}</span>
          </label>
        ))
      ) : (
        <span className="note">none</span>
      )}
    </div>
  );
}

export function CheckApiExternalPage(): React.ReactElement {
  // Entry point is a live CF org/space — same picker CF Log/Restart uses — NOT a "Deploy Target"
  // (a GitLab-group-centric record that exists for Deploy Model's MR workflow). Testing a deployed
  // service is fundamentally a CF/BTP concern: the org/space is what determines which apps exist
  // and are callable, so it shouldn't require a GitLab-side record to be created first.
  const [cfTarget, setCfTarget] = useState<TCfTargetSummary | undefined>();

  // --- Credential resolution: auto-suggest a credential already imported for this CF space.
  // Resolved BEFORE picking a live service (not after) — it's a space-wide concern (one xsuaa
  // instance shared by every app in the space), and having a valid token ready up front is what
  // lets the next step try the live app's own $metadata index before ever touching GitLab. ---
  const credentialSuggestion = useAsync((cfTargetKey: string) => toolStudioApi.getBtpCredentialSuggestion(cfTargetKey));
  const [credential, setCredential] = useState<TBtpServiceCredential | undefined>();
  useEffect(() => {
    setCredential(undefined);
    if (cfTarget) {
      void credentialSuggestion.run(cfTarget.key).then((result) => {
        if (result?.credential) setCredential(result.credential);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget]);

  const [showImportCredential, setShowImportCredential] = useState(false);
  const [importAppName, setImportAppName] = useState<string | undefined>();
  const candidatesCall = useAsync((key: string, app: string) => toolStudioApi.getXsuaaCandidates(key, app));
  const saveCredentialCall = useAsync((key: string, app: string, serviceName: string) => toolStudioApi.saveBtpCredential({ targetKey: key, appName: app, serviceName }));

  useEffect(() => {
    if (cfTarget && importAppName) void candidatesCall.run(cfTarget.key, importAppName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget, importAppName]);

  // --- Live CF apps (reuses the same cached /api/btp/apps endpoint BtpAppSelector uses elsewhere)
  // — this is what actually answers "what's deployed", instead of a GitLab repo count that can
  // include things nobody has ever pushed to a space. ---
  const liveApps = useAsync((targetKey: string, refresh?: boolean) => studioApi.getBtpApps(targetKey, refresh));
  useEffect(() => {
    if (cfTarget) void liveApps.run(cfTarget.key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget]);

  const srvAppOptions = useMemo(
    () =>
      (liveApps.data?.apps ?? [])
        .filter((app) => SRV_APP_NAME_RE.test(app.name))
        .map((app) => ({ value: app.name, label: app.name, meta: `${app.requestedState ?? ""}${app.routes ? ` · ${app.routes.split(",")[0].trim()}` : ""}` })),
    [liveApps.data],
  );
  const [selectedAppName, setSelectedAppName] = useState("");
  const selectedLiveApp = useMemo(() => liveApps.data?.apps.find((app) => app.name === selectedAppName), [liveApps.data, selectedAppName]);

  const [baseUrlOverride, setBaseUrlOverride] = useState("");
  useEffect(() => {
    setBaseUrlOverride("");
  }, [selectedAppName]);
  const liveRoute = selectedLiveApp?.routes?.split(",")[0]?.trim();
  const resolvedBaseUrl = liveRoute ? `https://${liveRoute}` : baseUrlOverride;

  // --- CDS services for the ONE picked app — tries the app's own live index first (needs the
  // credential + route above), falls back to a lazy, single-repo GitLab scan (see
  // cds-service-discovery.ts) ONLY when some Deploy Target happens to already link this exact CF
  // target to a GitLab group (opportunistic enrichment, never a requirement to proceed). ---
  const appServices = useAsync((cfTargetKey: string, appName: string, credentialId: string | undefined, baseUrl: string | undefined, refresh?: boolean) =>
    toolStudioApi.getAppServices({ cfTargetKey, appName, credentialId, baseUrl, refresh }),
  );
  useEffect(() => {
    if (cfTarget && selectedAppName) void appServices.run(cfTarget.key, selectedAppName, credential?.id, resolvedBaseUrl || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget, selectedAppName, credential, resolvedBaseUrl]);

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

  // --- $metadata-driven query builder (unchanged once a service + credential are resolved) ---
  const metadata = useAsync((credentialId: string, baseUrl: string, servicePath: string) => toolStudioApi.getCheckApiMetadata(credentialId, baseUrl, servicePath));

  const [entitySelection, setEntitySelection] = useState(""); // "set:<EntitySet>" or "fn:<FunctionImport>"
  const [selectFields, setSelectFields] = useState<Set<string>>(new Set());
  const [expandFields, setExpandFields] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [filterProperty, setFilterProperty] = useState("");
  const [filterOperator, setFilterOperator] = useState("eq");
  const [filterValue, setFilterValue] = useState("");
  const [orderText, setOrderText] = useState("");
  const [orderProperty, setOrderProperty] = useState("");
  const [orderDirection, setOrderDirection] = useState<"asc" | "desc">("asc");
  const [top, setTop] = useState("");
  const [skip, setSkip] = useState("");
  const [count, setCount] = useState(false);
  const [httpMethod, setHttpMethod] = useState("GET");
  const [requestBodyText, setRequestBodyText] = useState("");
  const [functionParamValues, setFunctionParamValues] = useState<Record<string, string>>({});

  useEffect(() => {
    // `path` starts at "/" until a CDS service is actually chosen (or typed manually) — firing the
    // fetch against that placeholder produced a confusing "404" before the user had picked anything.
    if (credential && resolvedBaseUrl && path && path !== "/") void metadata.run(credential.id, resolvedBaseUrl, path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credential, resolvedBaseUrl, path]);

  useEffect(() => {
    setEntitySelection("");
    setSelectFields(new Set());
    setExpandFields(new Set());
    setFilterText("");
    setOrderText("");
    setFunctionParamValues({});
  }, [metadata.data]);

  useEffect(() => {
    setSelectFields(new Set());
    setExpandFields(new Set());
    setFilterText("");
    setOrderText("");
    setFunctionParamValues({});
  }, [entitySelection]);

  const version = metadata.data?.version ?? "v2";
  const selectedEntitySet = entitySelection.startsWith("set:") ? metadata.data?.entitySets.find((set) => set.name === entitySelection.slice(4)) : undefined;
  const selectedEntityType: TODataEntityType | undefined = selectedEntitySet ? metadata.data?.entityTypes[selectedEntitySet.entityTypeName] : undefined;
  const selectedFunction = entitySelection.startsWith("fn:") ? metadata.data?.functionImports.find((fn) => fn.name === entitySelection.slice(3)) : undefined;

  const entityOptions = useMemo(
    () => [
      ...(metadata.data?.entitySets.map((set) => ({ value: `set:${set.name}`, label: set.name, meta: "entity set" })) ?? []),
      ...(metadata.data?.functionImports.map((fn) => ({ value: `fn:${fn.name}`, label: fn.name, meta: `function · ${fn.httpMethod}` })) ?? []),
    ],
    [metadata.data],
  );

  function buildQueryParams(): Record<string, string> {
    const params: Record<string, string> = {};
    if (selectedFunction) {
      for (const [key, value] of Object.entries(functionParamValues)) if (value) params[key] = value;
      return params;
    }
    if (selectFields.size) params.$select = Array.from(selectFields).join(",");
    if (expandFields.size) params.$expand = Array.from(expandFields).join(",");
    if (filterText.trim()) params.$filter = filterText.trim();
    if (orderText.trim()) params.$orderby = orderText.trim();
    if (top.trim()) params.$top = top.trim();
    if (skip.trim()) params.$skip = skip.trim();
    if (count) {
      if (version === "v4") params.$count = "true";
      else params.$inlinecount = "allpages";
    }
    return params;
  }

  const callApi = useAsync(() => {
    let parsedBody: unknown;
    if (httpMethod !== "GET" && requestBodyText.trim()) {
      try {
        parsedBody = JSON.parse(requestBodyText);
      } catch {
        throw new Error("Request body is not valid JSON.");
      }
    }
    // `path` is the SERVICE's own mount path (e.g. `/BusinessPartnerConsolidateService`); the
    // entity set/function is a sub-resource of it, not a replacement for it — confirmed by an
    // actual live call 404ing ("Cannot GET /MDConsolidateLog") when this dropped the service
    // prefix entirely instead of appending to it.
    let callPath = path;
    if (entitySelection) {
      const name = entitySelection.slice(entitySelection.indexOf(":") + 1);
      callPath = `${path.replace(/\/+$/, "")}/${name}`;
    }
    return toolStudioApi.callCheckApi({ credentialId: credential!.id, baseUrl: resolvedBaseUrl, path: callPath, method: httpMethod, queryParams: buildQueryParams(), body: parsedBody });
  });

  return (
    <div>
      <div className="ts-header">
        <h1>Check API External</h1>
        <p className="note">
          Pick a CF org/space, then a service that's actually running there (a live <code>cf apps</code> listing).
          Its OData path(s) are discovered straight from the service itself when possible, falling back to a GitLab
          source scan only if a Deploy Target already links this space to a GitLab group — then entity sets, fields,
          and navigation properties come from a live <code>$metadata</code> call, the same way an API docs page would
          present them. Nothing is hand-typed unless a service can't be auto-detected.
        </p>
      </div>

      {!cfTarget ? (
        <div className="ts-card" style={{ maxWidth: 1100 }}>
          <div className="note" style={{ marginBottom: 8 }}>Select the CF org/space whose deployed services you want to test:</div>
          <BtpTargetSelector onSelect={setCfTarget} />
        </div>
      ) : (
        <div className="ts-card" style={{ maxWidth: 1100 }}>
          <div className="field">
            <div className="row" style={{ alignItems: "baseline" }}>
              <label style={{ flex: 1, marginBottom: 0 }}>CF target</label>
              <Button variant="ghost" size="sm" onClick={() => setCfTarget(undefined)}>Change</Button>
            </div>
            <div className="note">{cfTarget.org} / {cfTarget.space} ({cfTarget.region})</div>
          </div>

          <div className="field">
            <label>Credential</label>
            {credential ? (
              <div className="row">
                <div className="note" style={{ flex: 1 }}>{credential.name} · {credential.region} · {credential.org}/{credential.space}</div>
                <Button variant="ghost" size="sm" onClick={() => { setCredential(undefined); setShowImportCredential(true); }}>Change</Button>
              </div>
            ) : showImportCredential ? (
              <div className="ts-card" style={{ marginTop: 8 }}>
                {!importAppName ? (
                  <BtpAppSelector targetKey={cfTarget.key} targetLabel={`${cfTarget.org} / ${cfTarget.space} (${cfTarget.region})`} onSelect={setImportAppName} onBack={() => setShowImportCredential(false)} />
                ) : (
                  <>
                    <div className="note" style={{ marginBottom: 8 }}>xsuaa-shaped services found in {importAppName}'s cf env:</div>
                    {candidatesCall.loading ? (
                      <EmptyState><Spinner /> loading services...</EmptyState>
                    ) : candidatesCall.error || candidatesCall.data?.error ? (
                      <div className="errbox">{candidatesCall.error || candidatesCall.data?.error}</div>
                    ) : !candidatesCall.data?.candidates.length ? (
                      <EmptyState>No xsuaa/uaa-shaped service found bound to this app.</EmptyState>
                    ) : (
                      <div className="wiz-body">
                        {candidatesCall.data.candidates.map((candidate) => (
                          <div key={candidate.serviceName} className="trow">
                            <div className="trow-main">
                              <div className="trow-title">{candidate.serviceName}</div>
                              <div className="trow-meta">{candidate.servicePlan ?? ""} · {candidate.url}</div>
                            </div>
                            <Button
                              size="sm"
                              disabled={saveCredentialCall.loading}
                              onClick={async () => {
                                const saved = await saveCredentialCall.run(cfTarget.key, importAppName, candidate.serviceName);
                                if (saved?.credential) {
                                  setCredential(saved.credential);
                                  setShowImportCredential(false);
                                  setImportAppName(undefined);
                                }
                              }}
                            >
                              Import
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {saveCredentialCall.error && <div className="errbox" style={{ marginTop: 8 }}>{saveCredentialCall.error}</div>}
                  </>
                )}
              </div>
            ) : (
              <Button size="sm" onClick={() => setShowImportCredential(true)}>Import a credential from BTP</Button>
            )}
          </div>

          <div className="field">
            <div className="row" style={{ marginBottom: 6, alignItems: "baseline" }}>
              <label style={{ flex: 1, marginBottom: 0 }}>Live service ({srvAppOptions.length} srv app(s) running)</label>
              <Button variant="sec" size="sm" disabled={liveApps.loading} onClick={() => void liveApps.run(cfTarget.key, true)}>
                {liveApps.loading ? <Spinner /> : "⟳ Refresh"}
              </Button>
            </div>
            {liveApps.data?.updatedAgo && (
              <div className="note" style={{ marginBottom: 6 }}>Last checked {liveApps.data.updatedAgo}{liveApps.data.fromCache ? " (cached — refresh for the latest)" : ""}</div>
            )}
            {liveApps.loading && !liveApps.data ? (
              <EmptyState><Spinner /> loading cf apps...</EmptyState>
            ) : liveApps.error || liveApps.data?.error ? (
              <div className="errbox">{liveApps.error || liveApps.data?.error}</div>
            ) : !srvAppOptions.length ? (
              <EmptyState>No srv apps found running in this space.</EmptyState>
            ) : (
              <SearchableSelect
                value={selectedAppName}
                onChange={setSelectedAppName}
                placeholder="Select a running service..."
                searchPlaceholder="Search apps..."
                options={srvAppOptions}
              />
            )}
            {liveApps.data?.warning && <div className="note" style={{ marginTop: 6 }}>{liveApps.data.warning}</div>}
          </div>

          {selectedAppName && (
            <div className="field">
              <div className="row" style={{ marginBottom: 6, alignItems: "baseline" }}>
                <label style={{ flex: 1, marginBottom: 0 }}>
                  CDS service{appServices.data?.source && ` (discovered ${appServices.data.source === "live-index" ? "live from the service itself" : "via GitLab source scan"})`}
                </label>
                <Button
                  variant="sec"
                  size="sm"
                  disabled={appServices.loading}
                  onClick={() => void appServices.run(cfTarget.key, selectedAppName, credential?.id, resolvedBaseUrl || undefined, true)}
                >
                  {appServices.loading ? <Spinner /> : "⟳ Rescan"}
                </Button>
              </div>
              {appServices.loading ? (
                <EmptyState><Spinner /> resolving OData path(s) for {selectedAppName}...</EmptyState>
              ) : appServices.error ? (
                <div className="errbox">{appServices.error}</div>
              ) : appServices.data?.error ? (
                // A missing GitLab-group link is expected/normal (the fallback is opportunistic,
                // never required) — shown as informational rather than an error.
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
                <div className="note">{appServices.data.services[0].name} ({appServices.data.services[0].path})</div>
              )}
            </div>
          )}

          {selectedAppName && (
            <div className="field">
              <label>Service path</label>
              <input className="input" placeholder="/BusinessPartnerCommonService" value={path} onChange={(event) => setPath(event.target.value)} />
            </div>
          )}

          {selectedAppName && !liveRoute && (
            <div className="field">
              <label>Base URL (this app has no bound route — enter it manually)</label>
              <input className="input" placeholder="https://simplemdg-srv-bp.cfapps.us10.hana.ondemand.com" value={baseUrlOverride} onChange={(event) => setBaseUrlOverride(event.target.value)} />
            </div>
          )}

          {selectedAppName && credential && resolvedBaseUrl && (
            <div style={{ marginTop: 4 }}>
              {metadata.loading ? (
                <EmptyState><Spinner /> fetching $metadata...</EmptyState>
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
                      searchPlaceholder="Search..."
                      options={entityOptions}
                    />
                  </div>

                  {selectedFunction && (
                    <div className="field">
                      <label>Parameters</label>
                      {selectedFunction.parameters.length ? (
                        <div className="ts-grid-2">
                          {selectedFunction.parameters.map((param) => (
                            <div className="field" key={param.name}>
                              <label>{param.name} ({param.type}){param.nullable ? "" : " *"}</label>
                              <input
                                className="input"
                                value={functionParamValues[param.name] ?? ""}
                                onChange={(event) => setFunctionParamValues((prev) => ({ ...prev, [param.name]: event.target.value }))}
                              />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="note">No parameters.</div>
                      )}
                    </div>
                  )}

                  {selectedEntityType && (
                    <>
                      <div className="ts-grid-2">
                        <div className="field">
                          <label>$select ({selectFields.size || "all"})</label>
                          <CheckboxList
                            items={selectedEntityType.properties.map((p) => p.name)}
                            selected={selectFields}
                            onToggle={(value) => setSelectFields((prev) => toggleInSet(prev, value))}
                          />
                        </div>
                        <div className="field">
                          <label>$expand ({expandFields.size || "none"})</label>
                          <CheckboxList
                            items={selectedEntityType.navigationProperties.map((p) => p.name)}
                            selected={expandFields}
                            onToggle={(value) => setExpandFields((prev) => toggleInSet(prev, value))}
                          />
                        </div>
                      </div>

                      <div className="field">
                        <label>$filter (optional — build a condition below or edit the expression directly)</label>
                        <div className="row" style={{ marginBottom: 6 }}>
                          <div style={{ flex: 1, minWidth: 140 }}>
                            <SearchableSelect
                              value={filterProperty}
                              onChange={setFilterProperty}
                              placeholder="Property..."
                              options={selectedEntityType.properties.map((p) => ({ value: p.name, label: p.name, meta: p.type }))}
                            />
                          </div>
                          <div style={{ width: 150 }}>
                            <SearchableSelect value={filterOperator} onChange={setFilterOperator} options={FILTER_OPERATORS} />
                          </div>
                          <input className="input" style={{ flex: 1 }} placeholder="value" value={filterValue} onChange={(event) => setFilterValue(event.target.value)} />
                          <Button
                            size="sm"
                            disabled={!filterProperty || !filterValue}
                            onClick={() => {
                              const propType = selectedEntityType.properties.find((p) => p.name === filterProperty)?.type;
                              const clause = buildFilterClause(filterProperty, filterOperator, filterValue, propType, version);
                              setFilterText((prev) => (prev ? `${prev} and ${clause}` : clause));
                              setFilterValue("");
                            }}
                          >
                            + Add
                          </Button>
                        </div>
                        <input className="input" placeholder="e.g. salesOrganization eq '1000'" value={filterText} onChange={(event) => setFilterText(event.target.value)} />
                      </div>

                      <div className="field">
                        <label>$orderby (optional)</label>
                        <div className="row" style={{ marginBottom: 6 }}>
                          <div style={{ flex: 1, minWidth: 140 }}>
                            <SearchableSelect
                              value={orderProperty}
                              onChange={setOrderProperty}
                              placeholder="Property..."
                              options={selectedEntityType.properties.map((p) => ({ value: p.name, label: p.name }))}
                            />
                          </div>
                          <div style={{ width: 120 }}>
                            <SearchableSelect
                              value={orderDirection}
                              onChange={(value) => setOrderDirection(value as "asc" | "desc")}
                              options={[{ value: "asc", label: "asc" }, { value: "desc", label: "desc" }]}
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={!orderProperty}
                            onClick={() => {
                              const clause = `${orderProperty} ${orderDirection}`;
                              setOrderText((prev) => (prev ? `${prev},${clause}` : clause));
                            }}
                          >
                            + Add
                          </Button>
                        </div>
                        <input className="input" placeholder="e.g. customer asc" value={orderText} onChange={(event) => setOrderText(event.target.value)} />
                      </div>

                      <div className="ts-grid-2">
                        <div className="field">
                          <label>$top</label>
                          <input className="input" type="number" min={0} value={top} onChange={(event) => setTop(event.target.value)} />
                        </div>
                        <div className="field">
                          <label>$skip</label>
                          <input className="input" type="number" min={0} value={skip} onChange={(event) => setSkip(event.target.value)} />
                        </div>
                        <div className="field">
                          <label>
                            <input type="checkbox" checked={count} onChange={(event) => setCount(event.target.checked)} style={{ marginRight: 6 }} />
                            Include row count ({version === "v4" ? "$count" : "$inlinecount"})
                          </label>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="ts-grid-2">
                    <div className="field">
                      <label>Method</label>
                      <SearchableSelect
                        value={httpMethod}
                        onChange={setHttpMethod}
                        options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }))}
                      />
                    </div>
                  </div>
                  {httpMethod !== "GET" && (
                    <div className="field">
                      <label>Request body (JSON)</label>
                      <textarea className="input" style={{ minHeight: 120, fontFamily: "monospace" }} value={requestBodyText} onChange={(event) => setRequestBodyText(event.target.value)} />
                    </div>
                  )}

                  <div className="row" style={{ marginTop: 12 }}>
                    <Button onClick={() => void callApi.run()} disabled={callApi.loading || !entitySelection}>
                      {callApi.loading ? <Spinner /> : "Call"}
                    </Button>
                  </div>

                  {callApi.error && <div className="errbox" style={{ marginTop: 12 }}>{callApi.error}</div>}
                  {callApi.data && (
                    <div style={{ marginTop: 12 }}>
                      <div className="note">{callApi.data.url}</div>
                      <div className={callApi.data.ok ? "note" : "errbox"} style={{ marginBottom: 8 }}>HTTP {callApi.data.status}</div>
                      <pre className="cell-pre" style={{ maxHeight: 340, overflow: "auto" }}>{JSON.stringify(callApi.data.body, null, 2)}</pre>
                    </div>
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
