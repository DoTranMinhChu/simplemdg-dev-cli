import { useEffect, useState } from "react";
import { EmptyState } from "../common/EmptyState";
import { SchemaTree } from "./SchemaTree";
import { studioApi } from "../../api/studio-api-client";
import { useStudioStore } from "../../state/studio-store";
import type { TDatabaseErrorInfo, TDatabaseSchema } from "../../api/studio-api-types";

export function ObjectExplorer(): React.ReactElement {
  const { activeConnection, activeConnectionId, setConnectionStatus, setActiveSchema } = useStudioStore();
  const [schemas, setSchemas] = useState<TDatabaseSchema[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; info?: TDatabaseErrorInfo } | undefined>();

  useEffect(() => {
    if (!activeConnectionId) {
      setSchemas([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(undefined);

    studioApi
      .getSchemas(activeConnectionId)
      .then((response) => {
        if (cancelled) return;
        if (response.error) {
          setConnectionStatus(activeConnectionId, "failed");
          setError({ message: response.error, info: response.errorInfo as TDatabaseErrorInfo | undefined });
          setSchemas([]);
          return;
        }
        setConnectionStatus(activeConnectionId, "connected");
        const sorted = [...(response.schemas ?? [])].sort((a, b) => Number(a.isSystem) - Number(b.isSystem));
        setSchemas(sorted);
        const preferred = sorted.find((schema) => schema.name === activeConnection?.schema) ?? sorted.find((schema) => !schema.isSystem);
        if (preferred) setActiveSchema(preferred.name);
      })
      .catch((fetchError) => {
        if (cancelled) return;
        setError({ message: fetchError instanceof Error ? fetchError.message : String(fetchError) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConnectionId]);

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
      <div className="errbox adapter-err">
        <div style={{ fontWeight: 600 }}>Cannot load schemas from {activeConnection?.name ?? "connection"}</div>
        <div className="note" style={{ marginTop: 3 }}>
          {error.info?.kind ? `${error.info.kind} — ` : ""}
          {error.message}
        </div>
      </div>
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
