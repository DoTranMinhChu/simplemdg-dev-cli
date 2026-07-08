import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "../common/EmptyState";
import { ErrorPanel } from "../common/ErrorPanel";
import { SchemaTree } from "./SchemaTree";
import { studioApi } from "../../api/studio-api-client";
import { useStudioStore } from "../../state/studio-store";
import type { TDatabaseErrorInfo, TDatabaseSchema, TRecoveryAction } from "../../api/studio-api-types";

export function ObjectExplorer(): React.ReactElement {
  const { activeConnection, activeConnectionId, setConnectionStatus, setActiveSchema, toast } = useStudioStore();
  const [schemas, setSchemas] = useState<TDatabaseSchema[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; info?: TDatabaseErrorInfo; recoveryActions?: TRecoveryAction[] } | undefined>();
  const currentConnectionRef = useRef(activeConnectionId);
  currentConnectionRef.current = activeConnectionId;

  const load = useCallback(() => {
    const connectionId = activeConnectionId;
    if (!connectionId) {
      setSchemas([]);
      return;
    }

    setLoading(true);
    setError(undefined);

    studioApi
      .getSchemas(connectionId)
      .then((response) => {
        if (currentConnectionRef.current !== connectionId) return;
        if (response.error) {
          setConnectionStatus(connectionId, "failed");
          setError({ message: response.error, info: response.errorInfo, recoveryActions: response.recoveryActions });
          setSchemas([]);
          return;
        }
        setConnectionStatus(connectionId, "connected");
        const sorted = [...(response.schemas ?? [])].sort((a, b) => Number(a.isSystem) - Number(b.isSystem));
        setSchemas(sorted);
        const preferred = sorted.find((schema) => schema.name === activeConnection?.schema) ?? sorted.find((schema) => !schema.isSystem);
        if (preferred) setActiveSchema(preferred.name);
      })
      .catch((fetchError) => {
        if (currentConnectionRef.current !== connectionId) return;
        setError({ message: fetchError instanceof Error ? fetchError.message : String(fetchError) });
      })
      .finally(() => {
        if (currentConnectionRef.current === connectionId) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

  const canRefreshFromBtp = Boolean(activeConnection?.app && activeConnection?.region && activeConnection?.org && activeConnection?.space);

  const reconnect = async (): Promise<void> => {
    if (!activeConnectionId) return;
    toast("Reconnecting...");
    const result = await studioApi.reconnectConnection(activeConnectionId);
    if (result.success) {
      toast("Reconnected.");
      load();
    } else {
      toast(`Reconnect failed: ${result.message ?? ""}`, "err");
    }
  };

  const refreshFromBtp = async (): Promise<void> => {
    if (!activeConnectionId) return;
    toast("Refreshing credentials from BTP...");
    const result = await studioApi.refreshCredentialsFromBtp(activeConnectionId);
    if (result.ok) {
      toast(result.test?.success ? "Credentials refreshed and tested OK." : `Credentials refreshed (test: ${result.test?.message ?? "n/a"})`, result.test?.success ? "ok" : "warn");
      load();
    } else {
      toast(`Refresh from BTP failed: ${result.error ?? ""}`, "err");
    }
  };

  if (!activeConnectionId) {
    return <EmptyState>Select a connection.</EmptyState>;
  }

  if (loading) {
    return (
      <div className="tnote">
        <span className="spin" /> loading schemas...
      </div>
    );
  }

  if (error) {
    return (
      <ErrorPanel
        title={`Cannot load schemas from ${activeConnection?.name ?? "connection"}`}
        error={{ message: error.message, kind: error.info?.kind, technicalMessage: error.info?.originalMessage, recoveryActions: error.recoveryActions }}
        onRetry={load}
        onReconnect={reconnect}
        onRefreshFromBtp={refreshFromBtp}
        canRefreshFromBtp={canRefreshFromBtp}
      />
    );
  }

  if (!schemas.length) {
    return <EmptyState>No schemas found.</EmptyState>;
  }

  return (
    <div className="tree" tabIndex={0}>
      {schemas.map((schema) => (
        <SchemaTree key={schema.name} connectionId={activeConnectionId} schema={schema.name} onSelect={setActiveSchema} />
      ))}
    </div>
  );
}
