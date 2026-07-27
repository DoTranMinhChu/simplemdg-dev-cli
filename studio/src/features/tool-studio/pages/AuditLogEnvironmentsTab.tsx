import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { Icon } from "../../../components/common/Icon";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TAuditLogEnvironment } from "../api/tool-studio-api-client";
import { AddAuditLogEnvironmentModal } from "../components/AddAuditLogEnvironmentModal";

function EnvironmentRow({
  environment,
  onRemoved,
  onResolved,
  onJumpToStats,
}: {
  environment: TAuditLogEnvironment;
  onRemoved: () => void;
  onResolved: () => void;
  onJumpToStats: () => void;
}): React.ReactElement {
  const [resolving, setResolving] = useState(false);
  const [summary, setSummary] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const resolve = async (force: boolean): Promise<void> => {
    setResolving(true);
    setError(undefined);
    try {
      const response = await toolStudioApi.resolveAuditLogEnvironment(environment.id, force);
      if (response.error || !response.resolution) {
        setError(response.error ?? "Resolve failed");
      } else if (response.resolution.error) {
        setError(response.resolution.error);
      } else {
        const foundCount = response.resolution.entries.filter((entry) => entry.tables.length > 0).length;
        setSummary(`${foundCount}/${response.resolution.entries.length} catalog entries found a matching table`);
        onResolved();
      }
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="trow" style={{ cursor: "default" }}>
      <div className="trow-main">
        <div className="trow-title">
          {environment.projectName} / {environment.envLabel}
        </div>
        <div className="trow-meta">
          {environment.org} / {environment.space} ({environment.region}) — app {environment.appName}
          {environment.lastScannedAt ? ` · last scanned ${new Date(environment.lastScannedAt).toLocaleString()}` : " · never scanned"}
        </div>
        {summary && <div className="note">{summary}</div>}
        {error && <div className="errbox" style={{ marginTop: 4 }}>{error}</div>}
      </div>
      <div className="trow-right" style={{ gap: 6 }}>
        <Button variant="ghost" size="sm" title="View stats & trace for only this environment" onClick={onJumpToStats}>
          <Icon name="viw" />
        </Button>
        <Button variant="sec" size="sm" disabled={resolving} onClick={() => void resolve(false)}>
          {resolving ? <Spinner /> : "Resolve tables"}
        </Button>
        <Button variant="ghost" size="sm" disabled={resolving} onClick={() => void resolve(true)}>
          Force rescan
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            void toolStudioApi.removeAuditLogEnvironment(environment.id).then(onRemoved);
          }}
        >
          Remove
        </Button>
      </div>
    </div>
  );
}

export function AuditLogEnvironmentsTab({
  environments,
  onChanged,
  onJumpToEnvironment,
}: {
  environments: TAuditLogEnvironment[];
  onChanged: () => void;
  onJumpToEnvironment: (environmentId: string) => void;
}): React.ReactElement {
  const [showAddModal, setShowAddModal] = useState(false);

  return (
    <div>
      {showAddModal && (
        <AddAuditLogEnvironmentModal
          onClose={() => setShowAddModal(false)}
          onSaved={onChanged}
        />
      )}

      <div className="row" style={{ alignItems: "baseline", marginBottom: 8 }}>
        <h2 style={{ flex: 1, margin: 0 }}>Registered environments ({environments.length})</h2>
        <Button onClick={() => setShowAddModal(true)}>+ Add environment(s)</Button>
      </div>

      {!environments.length ? (
        <EmptyState>No environments registered yet — click "+ Add environment(s)".</EmptyState>
      ) : (
        <div className="ts-card" style={{ padding: 0 }}>
          {environments.map((environment) => (
            <EnvironmentRow
              key={environment.id}
              environment={environment}
              onRemoved={onChanged}
              onResolved={onChanged}
              onJumpToStats={() => onJumpToEnvironment(environment.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
