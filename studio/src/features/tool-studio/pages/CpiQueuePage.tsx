import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchableSelect } from "../../../components/common/SearchableSelect";
import { BtpTargetSelector } from "../../../components/btp/BtpTargetSelector";
import { BtpAppSelector } from "../../../components/btp/BtpAppSelector";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TCpiMessageProcessingLogEntry, TCpiQueueHealthResult, TQueueHealthInfo, TQueueHealthStatus } from "../api/tool-studio-api-client";
import type { TCfTargetSummary } from "../../../api/studio-api-types";
import { EVENT_MESH_TOPIC_OPTIONS, getEventPayloadTemplate } from "../constants/event-mesh-topics";

type TCpiQueueTab = "monitor" | "cpi-logs" | "send";

const CUSTOM_NAME_OPTION = { value: "__custom__", label: "Custom…" };

const MPL_STATUS_BADGE_CLASS: Record<string, string> = {
  COMPLETED: "fresh",
  FAILED: "expired",
  ESCALATED: "expired",
  PROCESSING: "refreshing",
  RETRY: "stale",
};

function formatTimestamp(value: string | undefined): string {
  if (!value) return "";
  // CPI's OData JSON dates arrive as `/Date(1700000000000)/`.
  const match = /\/Date\((\d+)\)\//.exec(value);
  const millis = match ? Number(match[1]) : Date.parse(value);
  if (!Number.isFinite(millis)) return value;
  return new Date(millis).toLocaleString();
}

function MplRow({ entry }: { entry: TCpiMessageProcessingLogEntry }): React.ReactElement {
  return (
    <div className="row" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-xs)", gap: 8, alignItems: "baseline" }}>
      <span className={`cbadge ${MPL_STATUS_BADGE_CLASS[entry.status ?? ""] ?? "missing"}`} style={{ flex: "none" }}>
        {entry.status ?? "?"}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.integrationFlowName ?? entry.messageGuid}</span>
      <span className="note" style={{ flex: "none", whiteSpace: "nowrap" }}>
        {entry.sender ?? "?"} → {entry.receiver ?? "?"} · {formatTimestamp(entry.logEnd ?? entry.logStart)}
      </span>
    </div>
  );
}

const HEALTH_BADGE_CLASS: Record<TQueueHealthStatus, string> = {
  healthy: "fresh",
  busy: "refreshing",
  stuck: "stale",
  failed: "expired",
  missing: "missing",
};

const HEALTH_LABEL: Record<TQueueHealthStatus, string> = {
  healthy: "Healthy",
  busy: "Busy",
  stuck: "Stuck",
  failed: "Failed",
  missing: "Not created",
};

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** One dense, single-line row per queue — the previous 2-line trow layout was the main source of scroll fatigue. */
function QueueHealthRow({ queue }: { queue: TQueueHealthInfo }): React.ReactElement {
  return (
    <div className="row" style={{ padding: "4px 0", borderBottom: "1px solid var(--border)", fontSize: "var(--font-size-xs)", gap: 8 }}>
      <span className={`cbadge ${HEALTH_BADGE_CLASS[queue.status]}`} style={{ flex: "none" }}>
        {HEALTH_LABEL[queue.status]}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {queue.queueName.split("/").pop()}
        {queue.isDeadLetter ? " (DMQ)" : ""}
      </span>
      <span className="note" style={{ flex: "none", whiteSpace: "nowrap" }}>
        {queue.exists
          ? `${queue.messageCount} msg · ${queue.unacknowledgedMessageCount ?? 0} unacked · ${queue.consumerCount} consumer(s)${
              queue.queueSizeInBytes !== undefined && queue.maxQueueSizeInBytes !== undefined ? ` · ${formatBytes(queue.queueSizeInBytes)}/${formatBytes(queue.maxQueueSizeInBytes)}` : ""
            }`
          : queue.error || "not created"}
      </span>
    </div>
  );
}

/** One card per Event Mesh instance, laid out 2-up (`ts-grid-2`) so several namespaces fit without scrolling past them one at a time. */
function QueueHealthGrid({ results }: { results: TCpiQueueHealthResult[] }): React.ReactElement {
  return (
    <div className="ts-grid-2">
      {results.map((instance) => (
        <div key={instance.serviceKeyFileName} className="ts-card" style={{ padding: "var(--space-3)", marginBottom: "var(--space-3)" }}>
          <div className="note" style={{ marginBottom: 4 }}>
            <b>{instance.serviceKeyFileName}</b> — {instance.namespace}
          </div>
          {instance.error ? <div className="errbox">{instance.error}</div> : instance.queues.map((queue) => <QueueHealthRow key={queue.queueName} queue={queue} />)}
        </div>
      ))}
    </div>
  );
}

/**
 * Target/app picker shared by both tabs — lifted out so switching tabs never re-triggers the
 * BTP target/app selection flow, only the action taken once an app is picked.
 */
function TargetAppPicker({
  cfTarget,
  appName,
  onSelectTarget,
  onSelectApp,
  onBackToTargets,
  onChangeApp,
}: {
  cfTarget: TCfTargetSummary | undefined;
  appName: string | undefined;
  onSelectTarget: (target: TCfTargetSummary) => void;
  onSelectApp: (appName: string) => void;
  onBackToTargets: () => void;
  onChangeApp: () => void;
}): React.ReactElement {
  if (!cfTarget) return <BtpTargetSelector onSelect={onSelectTarget} />;
  if (!appName) return <BtpAppSelector targetKey={cfTarget.key} targetLabel={`${cfTarget.org} / ${cfTarget.space} (${cfTarget.region})`} onSelect={onSelectApp} onBack={onBackToTargets} />;
  return (
    <div className="field" style={{ marginBottom: 0 }}>
      <div className="row" style={{ alignItems: "baseline" }}>
        <label style={{ flex: 1, marginBottom: 0 }}>Target app</label>
        <Button variant="ghost" size="sm" onClick={onChangeApp}>Change</Button>
      </div>
      <div className="note">{cfTarget.org} / {cfTarget.space} ({cfTarget.region}) — {appName}</div>
    </div>
  );
}

/**
 * Monitoring + test-publish surface for Event Mesh + CPI. The Monitor and CPI Logs tabs stay
 * strictly GET-shaped (queue counts, destination listing, CPI run history) — no create/modify/
 * delete of anything in BTP, by explicit request after the queue-creation feature that used to
 * live here was removed. The Send Event tab is the one deliberate exception: it publishes a real
 * test message straight to the Event Mesh broker's own REST API.
 */
export function CpiQueuePage(): React.ReactElement {
  const [tab, setTab] = useState<TCpiQueueTab>("monitor");
  const [cfTarget, setCfTarget] = useState<TCfTargetSummary | undefined>();
  const [appName, setAppName] = useState<string | undefined>();

  const health = useAsync((targetKey: string, selectedAppName: string) => toolStudioApi.checkEventMeshHealth({ targetKey, appName: selectedAppName }));
  useEffect(() => {
    if (cfTarget && appName) void health.run(cfTarget.key, appName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget, appName]);

  // Lists BTP destinations, then reads CPI's own iflow run history for the one the user picks,
  // independent of whether it ever reached Event Mesh.
  const destinations = useAsync((targetKey: string, selectedAppName: string) => toolStudioApi.listCpiDestinations({ targetKey, appName: selectedAppName }));
  const [destinationName, setDestinationName] = useState("");
  const mpl = useAsync((targetKey: string, selectedAppName: string, selectedDestination: string) => toolStudioApi.getCpiMessageProcessingLogs({ targetKey, appName: selectedAppName, destinationName: selectedDestination }));
  useEffect(() => {
    if (cfTarget && appName) void destinations.run(cfTarget.key, appName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget, appName]);
  useEffect(() => {
    setDestinationName("");
    mpl.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinations.data]);
  useEffect(() => {
    if (cfTarget && appName && destinationName) void mpl.run(cfTarget.key, appName, destinationName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationName]);
  const destinationOptions = useMemo(
    () =>
      (destinations.data?.destinations ?? []).map((destination) => ({
        value: destination.name,
        label: destination.name,
        meta: [destination.authentication, destination.url].filter(Boolean).join(" · "),
      })),
    [destinations.data],
  );

  // --- Send Event tab: pick an instance, then a topic (select from the real TOPIC_ENUM list,
  // namespace-qualified automatically) or a queue (live-listed via the Management API when
  // possible), with a "Custom…" escape hatch for either — then publish straight to the broker. ---
  // Fetched as soon as an app is picked (same as `health` above), not gated on `tab === "send"` —
  // otherwise switching tabs away and back re-fetches every time instead of reusing what's already
  // loaded, since useAsync has no request-dedup of its own.
  const instances = useAsync((targetKey: string, selectedAppName: string) => toolStudioApi.listEventMeshInstances({ targetKey, appName: selectedAppName }));
  useEffect(() => {
    if (cfTarget && appName) void instances.run(cfTarget.key, appName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget, appName]);

  const [instanceKey, setInstanceKey] = useState("");
  useEffect(() => {
    const list = instances.data?.instances ?? [];
    setInstanceKey(list.length === 1 ? list[0].serviceKeyFileName : "");
  }, [instances.data]);
  const selectedInstance = instances.data?.instances.find((instance) => instance.serviceKeyFileName === instanceKey);

  const [kind, setKind] = useState<"topic" | "queue">("topic");
  const [nameValue, setNameValue] = useState("");
  const [customName, setCustomName] = useState("");
  const [qos, setQos] = useState("1");
  const [payloadText, setPayloadText] = useState("");
  const [payloadFormatError, setPayloadFormatError] = useState("");
  const lastAutoFilledPayloadRef = useRef("");

  function formatPayloadText(): void {
    try {
      setPayloadText(JSON.stringify(JSON.parse(payloadText), null, 2));
      setPayloadFormatError("");
    } catch {
      setPayloadFormatError("Payload is not valid JSON — can't format.");
    }
  }

  const queues = useAsync((targetKey: string, selectedAppName: string, serviceKeyFileName: string) => toolStudioApi.listEventMeshQueues({ targetKey, appName: selectedAppName, serviceKeyFileName }));
  useEffect(() => {
    if (cfTarget && appName && kind === "queue" && instanceKey) void queues.run(cfTarget.key, appName, instanceKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfTarget, appName, kind, instanceKey]);

  useEffect(() => {
    setNameValue("");
    setCustomName("");
    setPayloadText("");
    setPayloadFormatError("");
    lastAutoFilledPayloadRef.current = "";
    queues.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceKey, kind]);

  useEffect(() => {
    if (kind !== "topic" || !nameValue || nameValue === "__custom__") return;
    const template = JSON.stringify(getEventPayloadTemplate(nameValue), null, 2);
    if (!payloadText.trim() || payloadText === lastAutoFilledPayloadRef.current) {
      setPayloadText(template);
      lastAutoFilledPayloadRef.current = template;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameValue]);

  const resolvedName = nameValue === "__custom__" ? customName.trim() : kind === "topic" && nameValue && selectedInstance ? `${selectedInstance.namespace}/${nameValue}` : nameValue;

  const publish = useAsync(() => {
    let payload: unknown;
    try {
      payload = payloadText.trim() ? JSON.parse(payloadText) : {};
    } catch {
      throw new Error("Payload is not valid JSON.");
    }
    return toolStudioApi.publishEventMeshMessage({ targetKey: cfTarget!.key, appName: appName!, serviceKeyFileName: instanceKey, kind, name: resolvedName, qos, payload });
  });

  const resetSelection = (): void => {
    setCfTarget(undefined);
    setAppName(undefined);
    health.reset();
    destinations.reset();
    setDestinationName("");
    instances.reset();
    queues.reset();
    publish.reset();
    setInstanceKey("");
    setNameValue("");
    setCustomName("");
  };

  return (
    <div>
      <div className="ts-header">
        <h1>CPI Queue / Event Mesh</h1>
        <p className="note">
          Pick a CF org/space and any app already deployed there — credentials are read live from that app's own{" "}
          <code>cf env</code>. Monitor and CPI Logs are read-only (live counts and history, never creates/changes/
          deletes anything in BTP); Send Event is the one exception — it publishes a real test message.
        </p>
      </div>

      <div className="ts-tabs">
        <button className={`ts-tab${tab === "monitor" ? " active" : ""}`} onClick={() => setTab("monitor")}>Monitor</button>
        <button className={`ts-tab${tab === "cpi-logs" ? " active" : ""}`} onClick={() => setTab("cpi-logs")}>CPI Logs</button>
        <button className={`ts-tab${tab === "send" ? " active" : ""}`} onClick={() => setTab("send")}>Send Event</button>
      </div>

      <div className="ts-card">
        <TargetAppPicker
          cfTarget={cfTarget}
          appName={appName}
          onSelectTarget={setCfTarget}
          onSelectApp={setAppName}
          onBackToTargets={() => setCfTarget(undefined)}
          onChangeApp={resetSelection}
        />
      </div>

      {cfTarget && appName && tab === "monitor" && (
        <div style={{ marginTop: 16 }}>
          <div className="row" style={{ marginBottom: 8, alignItems: "baseline" }}>
            <p className="note" style={{ flex: 1, margin: 0 }}>
              Live message/consumer counts per queue.
            </p>
            <Button variant="sec" size="sm" onClick={() => void health.run(cfTarget.key, appName)} disabled={health.loading}>
              {health.loading ? <Spinner /> : "⟳ Refresh"}
            </Button>
          </div>

          {health.loading && !health.data ? (
            <EmptyState><Spinner /> checking queue health...</EmptyState>
          ) : health.error ? (
            <div className="errbox">{health.error}</div>
          ) : health.data?.error ? (
            <div className="errbox">{health.data.error}</div>
          ) : health.data?.results && !health.data.results.length ? (
            <EmptyState>No Event Mesh instance found bound to {appName}.</EmptyState>
          ) : health.data?.results ? (
            <QueueHealthGrid results={health.data.results} />
          ) : null}
        </div>
      )}

      {cfTarget && appName && tab === "cpi-logs" && (
        <div style={{ marginTop: 16 }}>
          <p className="note" style={{ marginTop: 0 }}>
            CPI's own iflow run history for a BTP destination, independent of whether the message ever reached Event
            Mesh. Pick a destination to see its recent runs.
          </p>

          {destinations.loading && !destinations.data ? (
            <EmptyState><Spinner /> loading destinations...</EmptyState>
          ) : destinations.error ? (
            <div className="errbox">{destinations.error}</div>
          ) : destinations.data?.error ? (
            <div className="errbox">{destinations.data.error}</div>
          ) : !destinationOptions.length ? (
            <EmptyState>No BTP destinations found for this space.</EmptyState>
          ) : (
            <>
              <div className="field">
                <label>Destination</label>
                <SearchableSelect value={destinationName} onChange={setDestinationName} placeholder="Select a destination..." searchPlaceholder="Search destinations..." options={destinationOptions} />
              </div>

              {destinationName && (
                <div style={{ marginTop: 12 }}>
                  <div className="row" style={{ marginBottom: 8, alignItems: "baseline" }}>
                    <span className="note" style={{ flex: 1 }}>Most recent 50 runs, newest first.</span>
                    <Button variant="sec" size="sm" onClick={() => void mpl.run(cfTarget.key, appName, destinationName)} disabled={mpl.loading}>
                      {mpl.loading ? <Spinner /> : "⟳ Refresh"}
                    </Button>
                  </div>
                  {mpl.loading && !mpl.data ? (
                    <EmptyState><Spinner /> loading message processing logs...</EmptyState>
                  ) : mpl.error ? (
                    <div className="errbox">{mpl.error}</div>
                  ) : mpl.data?.error ? (
                    <div className="errbox">{mpl.data.error}</div>
                  ) : mpl.data?.entries && !mpl.data.entries.length ? (
                    <EmptyState>No runs found for this destination.</EmptyState>
                  ) : mpl.data?.entries ? (
                    <div className="ts-card">
                      {mpl.data.entries.map((entry) => (
                        <MplRow key={entry.messageGuid} entry={entry} />
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {cfTarget && appName && tab === "send" && (
        <div style={{ marginTop: 16 }}>
          <p className="note" style={{ marginTop: 0 }}>
            Publishes a real message straight to the Event Mesh broker's own REST API (client-credentials token, then a{" "}
            <code>POST .../messagingrest/v1/{"{"}topics|queues{"}"}/...</code>). Topics route to whoever's subscribed and
            don't need to pre-exist; queues must already be provisioned in BTP.
          </p>

          {instances.loading && !instances.data ? (
            <EmptyState><Spinner /> loading Event Mesh instances...</EmptyState>
          ) : instances.error || instances.data?.error ? (
            <div className="errbox">{instances.error || instances.data?.error}</div>
          ) : !instances.data?.instances.length ? (
            <EmptyState>No Event Mesh instance found bound to {appName}.</EmptyState>
          ) : (
            <>
              <div className="field">
                <label>Event Mesh instance</label>
                <SearchableSelect
                  value={instanceKey}
                  onChange={setInstanceKey}
                  placeholder="Select an instance..."
                  searchPlaceholder="Search instances..."
                  options={instances.data.instances.map((instance) => ({
                    value: instance.serviceKeyFileName,
                    label: `${instance.namespace} (${instance.serviceKeyFileName})`,
                    meta: instance.canPublish ? undefined : "no httprest protocol — can't publish",
                  }))}
                />
              </div>

              {instanceKey && !selectedInstance?.canPublish && (
                <div className="errbox">
                  This instance's service key has no <code>httprest</code> protocol entry in its <code>messaging</code> block, so it can't be used to publish.
                </div>
              )}

              {instanceKey && selectedInstance?.canPublish && (
                <>
                  <div className="ts-grid-2">
                    <div className="field">
                      <label>Kind</label>
                      <SearchableSelect
                        value={kind}
                        onChange={(value) => setKind(value as "topic" | "queue")}
                        options={[
                          { value: "topic", label: "Topic" },
                          { value: "queue", label: "Queue" },
                        ]}
                      />
                    </div>
                    <div className="field">
                      <label>Quality of Service</label>
                      <SearchableSelect
                        value={qos}
                        onChange={setQos}
                        options={[
                          { value: "1", label: "1 — at-least-once" },
                          { value: "0", label: "0 — at-most-once" },
                        ]}
                      />
                    </div>
                  </div>

                  <div className="field">
                    <label>{kind === "topic" ? `Topic (under ${selectedInstance.namespace}/...)` : "Queue"}</label>
                    {kind === "queue" && queues.loading ? (
                      <EmptyState><Spinner /> loading live queues...</EmptyState>
                    ) : (
                      <SearchableSelect
                        value={nameValue}
                        onChange={setNameValue}
                        placeholder={`Select a ${kind}...`}
                        searchPlaceholder="Search..."
                        options={
                          kind === "topic"
                            ? [...EVENT_MESH_TOPIC_OPTIONS, CUSTOM_NAME_OPTION]
                            : [...(queues.data?.queues ?? []).map((queueName) => ({ value: queueName, label: queueName.split("/").pop() ?? queueName, meta: queueName })), CUSTOM_NAME_OPTION]
                        }
                      />
                    )}
                    {kind === "queue" && !queues.loading && !queues.data?.queues.length && (
                      <div className="note" style={{ marginTop: 6 }}>
                        {queues.data?.error || "Couldn't list live queues for this instance — use \"Custom…\" and type the name, e.g. copy it from the Monitor tab."}
                      </div>
                    )}
                    {nameValue === "__custom__" && (
                      <input
                        className="input"
                        style={{ marginTop: 6 }}
                        placeholder={kind === "topic" ? `e.g. ${selectedInstance.namespace}/ValidateParallelChange` : "queue name"}
                        value={customName}
                        onChange={(event) => setCustomName(event.target.value)}
                      />
                    )}
                  </div>

                  <div className="field">
                    <div className="row" style={{ alignItems: "baseline" }}>
                      <label style={{ flex: 1, marginBottom: 0 }}>Payload (JSON)</label>
                      <Button variant="ghost" size="sm" onClick={formatPayloadText}>Format</Button>
                    </div>
                    <textarea
                      className="input"
                      style={{ minHeight: 160, fontFamily: "monospace" }}
                      value={payloadText}
                      onChange={(event) => {
                        setPayloadText(event.target.value);
                        setPayloadFormatError("");
                      }}
                    />
                    {payloadFormatError && <div className="note" style={{ marginTop: 4 }}>{payloadFormatError}</div>}
                  </div>

                  <div className="row" style={{ marginTop: 4 }}>
                    <Button onClick={() => void publish.run()} disabled={publish.loading || !resolvedName}>
                      {publish.loading ? <Spinner /> : "Send"}
                    </Button>
                  </div>

                  {publish.error && <div className="errbox" style={{ marginTop: 12 }}>{publish.error}</div>}
                  {publish.data && (
                    <div style={{ marginTop: 12 }}>
                      <div className={publish.data.error || (publish.data.status ?? 0) >= 400 ? "errbox" : "note"}>
                        {publish.data.error
                          ? publish.data.error
                          : `${(publish.data.status ?? 0) < 400 ? "✓ Sent successfully" : "✗ Failed"} — HTTP ${publish.data.status} ${publish.data.statusText ?? ""}`}
                      </div>
                      {publish.data.body && (
                        <pre className="cell-pre" style={{ marginTop: 8, maxHeight: 260, overflow: "auto" }}>
                          {publish.data.body}
                        </pre>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
