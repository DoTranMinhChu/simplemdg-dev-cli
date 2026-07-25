import { useEffect, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { Spinner } from "../../../components/common/Spinner";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TAuditLogDefinition, TAuditLogEnvironment } from "../api/tool-studio-api-client";
import { AuditLogEnvironmentsTab } from "./AuditLogEnvironmentsTab";
import { AuditLogStatsTab } from "./AuditLogStatsTab";
import { AuditLogTraceTab } from "./AuditLogTraceTab";
import { AuditLogDetailTab } from "./AuditLogDetailTab";

type TAuditLogPageTab = "environments" | "stats" | "trace" | "detail";

/**
 * Cross-project, cross-environment audit-log monitor. Backed by src/core/audit-log/* on the
 * server: a static catalog of every log/message entity the CAP codebase defines (core, scattered
 * across db_process/db_config/db_user/... , plus the master-data-domain pattern that repeats once
 * per business-partner/customer/product/... package), a registry of monitored BTP environments
 * (credentials cached via the same encrypted connection store DB Studio uses), a table resolver
 * that probes which of those logs actually exist in a given environment's schema, and a query
 * service that only ever runs parameterized SQL (never a user-built WHERE string).
 */
export function AuditLogPage(): React.ReactElement {
  const [tab, setTab] = useState<TAuditLogPageTab>("environments");
  const [environments, setEnvironments] = useState<TAuditLogEnvironment[]>([]);
  const [catalog, setCatalog] = useState<TAuditLogDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEnvironmentIds, setSelectedEnvironmentIds] = useState<string[]>([]);
  const [detailTarget, setDetailTarget] = useState<{ environmentId: string; catalogId: string; tableIndex?: number } | undefined>();

  const reloadEnvironments = async (): Promise<void> => {
    const response = await toolStudioApi.listAuditLogEnvironments();
    setEnvironments(response.environments);
    setSelectedEnvironmentIds((prev) => prev.filter((id) => response.environments.some((environment) => environment.id === id)));
  };

  useEffect(() => {
    void (async () => {
      const [environmentsResponse, catalogResponse] = await Promise.all([toolStudioApi.listAuditLogEnvironments(), toolStudioApi.listAuditLogCatalog()]);
      setEnvironments(environmentsResponse.environments);
      setCatalog(catalogResponse.catalog);
      setSelectedEnvironmentIds(environmentsResponse.environments.map((environment) => environment.id));
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <EmptyState>
        <Spinner /> loading audit log monitor...
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="ts-header">
        <h1>Audit Log Monitor</h1>
        <p className="note">
          One place for every audit/log table the CAP codebase defines — activation/replication logs, Event Mesh outbox tables, mass-upload
          batch logs, workflow action logs, generic config/admin audit trails, and the per-master-data-domain consolidation/status-log
          pattern (business-partner, customer, product, ...). Register a BTP subaccount once (credentials are cached and reused), then
          scan stats across projects, trace one correlation key everywhere it appears, or drill into one raw table.
        </p>
      </div>

      <div className="ts-tabs">
        <button className={`ts-tab${tab === "environments" ? " active" : ""}`} onClick={() => setTab("environments")}>
          Environments ({environments.length})
        </button>
        <button className={`ts-tab${tab === "stats" ? " active" : ""}`} onClick={() => setTab("stats")}>Stats</button>
        <button className={`ts-tab${tab === "trace" ? " active" : ""}`} onClick={() => setTab("trace")}>Trace</button>
        <button className={`ts-tab${tab === "detail" ? " active" : ""}`} onClick={() => setTab("detail")}>Detail Viewer</button>
      </div>

      {tab === "environments" && <AuditLogEnvironmentsTab environments={environments} onChanged={() => void reloadEnvironments()} />}

      {tab === "stats" && (
        <AuditLogStatsTab
          environments={environments}
          catalog={catalog}
          selectedEnvironmentIds={selectedEnvironmentIds}
          onChangeSelection={setSelectedEnvironmentIds}
          onOpenDetail={(environmentId, catalogId) => {
            setDetailTarget({ environmentId, catalogId, tableIndex: 0 });
            setTab("detail");
          }}
        />
      )}

      {tab === "trace" && (
        <AuditLogTraceTab environments={environments} catalog={catalog} selectedEnvironmentIds={selectedEnvironmentIds} onChangeSelection={setSelectedEnvironmentIds} />
      )}

      {tab === "detail" && <AuditLogDetailTab environments={environments} catalog={catalog} initialTarget={detailTarget} />}
    </div>
  );
}
