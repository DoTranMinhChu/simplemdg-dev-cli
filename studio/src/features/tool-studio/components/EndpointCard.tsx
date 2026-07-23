import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { JsonView } from "../../../components/common/JsonView";
import { Modal } from "../../../components/common/Modal";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TODataEntityType, TODataFunctionImport } from "../api/tool-studio-api-client";

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

/** Pretty-prints the textarea's current content in place; silently a no-op on invalid JSON — a
 * failed format shouldn't destroy what the user typed. */
function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export type TEndpointCardProps = {
  kind: "set" | "fn";
  name: string;
  entityType?: TODataEntityType;
  functionImport?: TODataFunctionImport;
  version: "v2" | "v4";
  credentialId: string;
  baseUrl: string;
  /** The CDS service's own mount path (e.g. `/BusinessPartnerCommonService`) — this entity/function is a sub-resource of it, appended on call, never a replacement for it. */
  servicePath: string;
};

/**
 * One Swagger-style "operation" panel — the full $select/$expand/$filter/$orderby/$top/$skip/$count
 * query builder (or a parameter form, for a function import) plus its own "Call" + response. The
 * caller picks WHICH entity/function to show via a single dropdown (see CheckApiExternalPage), so
 * only one of these is ever mounted at a time — no collapse/expand of its own to manage.
 */
export function EndpointCard({ kind, name, entityType, functionImport, version, credentialId, baseUrl, servicePath }: TEndpointCardProps): React.ReactElement {
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
  // Function imports carry ONE fixed method in the service definition itself (calling one with a
  // different verb just 404s/405s) — only entity sets get a real choice, since CAP genuinely
  // supports the full GET/POST/PUT/PATCH/DELETE CRUD surface on those.
  const [httpMethod, setHttpMethod] = useState(kind === "fn" ? functionImport?.httpMethod || "GET" : "GET");
  const [requestBodyText, setRequestBodyText] = useState("");
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const [functionParamValues, setFunctionParamValues] = useState<Record<string, string>>({});

  const callApi = useAsync(() => {
    let parsedBody: unknown;
    if (httpMethod !== "GET" && requestBodyText.trim()) {
      try {
        parsedBody = JSON.parse(requestBodyText);
      } catch {
        throw new Error("Request body is not valid JSON.");
      }
    }

    const queryParams: Record<string, string> = {};
    if (kind === "fn") {
      for (const [key, value] of Object.entries(functionParamValues)) if (value) queryParams[key] = value;
    } else {
      if (selectFields.size) queryParams.$select = Array.from(selectFields).join(",");
      if (expandFields.size) queryParams.$expand = Array.from(expandFields).join(",");
      if (filterText.trim()) queryParams.$filter = filterText.trim();
      if (orderText.trim()) queryParams.$orderby = orderText.trim();
      if (top.trim()) queryParams.$top = top.trim();
      if (skip.trim()) queryParams.$skip = skip.trim();
      if (count) {
        if (version === "v4") queryParams.$count = "true";
        else queryParams.$inlinecount = "allpages";
      }
    }

    const callPath = `${servicePath.replace(/\/+$/, "")}/${name}`;
    return toolStudioApi.callCheckApi({ credentialId, baseUrl, path: callPath, method: httpMethod, queryParams, body: parsedBody });
  });

  return (
    <div className="ts-card endpoint-card" style={{ marginBottom: 8, padding: 0, overflow: "hidden" }}>
      <div className="endpoint-card-head" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <span className={`endpoint-kind-badge ${kind === "fn" ? (functionImport?.httpMethod || "GET").toLowerCase() : "set"}`}>
          {kind === "fn" ? functionImport?.httpMethod || "GET" : "SET"}
        </span>
        <span style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        <span className="note" style={{ flexShrink: 0 }}>
          {kind === "set" ? `${entityType?.properties.length ?? 0} field(s)` : `${functionImport?.parameters.length ?? 0} param(s)`}
        </span>
      </div>

      <div style={{ padding: "0 12px 12px", borderTop: "1px solid var(--border)" }}>
        {kind === "fn" && functionImport && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Parameters</label>
            {functionImport.parameters.length ? (
              <div className="ts-grid-2">
                {functionImport.parameters.map((param) => (
                  <div className="field" key={param.name}>
                    <label>
                      {param.name} ({param.type}){param.nullable ? "" : " *"}
                    </label>
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

        {kind === "set" && entityType && (
          <>
            <div className="ts-grid-2" style={{ marginTop: 12 }}>
              <div className="field">
                <label>$select ({selectFields.size || "all"})</label>
                <CheckboxList items={entityType.properties.map((p) => p.name)} selected={selectFields} onToggle={(value) => setSelectFields((prev) => toggleInSet(prev, value))} />
              </div>
              <div className="field">
                <label>$expand ({expandFields.size || "none"})</label>
                <CheckboxList
                  items={entityType.navigationProperties.map((p) => p.name)}
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
                    options={entityType.properties.map((p) => ({ value: p.name, label: p.name, meta: p.type }))}
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
                    const propType = entityType.properties.find((p) => p.name === filterProperty)?.type;
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
                  <SearchableSelect value={orderProperty} onChange={setOrderProperty} placeholder="Property..." options={entityType.properties.map((p) => ({ value: p.name, label: p.name }))} />
                </div>
                <div style={{ width: 120 }}>
                  <SearchableSelect
                    value={orderDirection}
                    onChange={(value) => setOrderDirection(value as "asc" | "desc")}
                    options={[
                      { value: "asc", label: "asc" },
                      { value: "desc", label: "desc" },
                    ]}
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
            {kind === "fn" ? (
              <div className="note">{httpMethod} — fixed by the service definition</div>
            ) : (
              <SearchableSelect value={httpMethod} onChange={setHttpMethod} options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => ({ value: m, label: m }))} />
            )}
          </div>
        </div>
        {httpMethod !== "GET" && (
          <div className="field">
            <div className="row" style={{ alignItems: "baseline" }}>
              <label style={{ flex: 1, marginBottom: 0 }}>Request body (JSON)</label>
              <Button variant="ghost" size="sm" onClick={() => setRequestBodyText((prev) => tryFormatJson(prev))}>
                Format
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setBodyExpanded(true)}>
                ⛶ Expand
              </Button>
            </div>
            <textarea className="input" style={{ minHeight: 120, fontFamily: "monospace" }} value={requestBodyText} onChange={(event) => setRequestBodyText(event.target.value)} />
          </div>
        )}

        {bodyExpanded && (
          <Modal onClose={() => setBodyExpanded(false)} width={1000}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <h3 style={{ margin: 0 }}>Request body (JSON)</h3>
              <div className="row" style={{ gap: 6 }}>
                <Button variant="ghost" size="sm" onClick={() => setRequestBodyText((prev) => tryFormatJson(prev))}>
                  Format
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setBodyExpanded(false)}>
                  ✕ Close
                </Button>
              </div>
            </div>
            <textarea
              className="input"
              style={{ minHeight: "70vh", width: "100%", fontFamily: "monospace" }}
              value={requestBodyText}
              onChange={(event) => setRequestBodyText(event.target.value)}
              autoFocus
            />
          </Modal>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <Button onClick={() => void callApi.run()} disabled={callApi.loading}>
            {callApi.loading ? <Spinner /> : "▶ Try it out"}
          </Button>
        </div>

        {callApi.error && <div className="errbox" style={{ marginTop: 12 }}>{callApi.error}</div>}
        {callApi.data && (
          <div style={{ marginTop: 12 }}>
            <div className="note">{callApi.data.url}</div>
            <div className={callApi.data.ok ? "note" : "errbox"} style={{ marginBottom: 8 }}>
              HTTP {callApi.data.status}
            </div>
            <JsonView value={callApi.data.body} title={`${name} response`} />
          </div>
        )}
      </div>
    </div>
  );
}
