import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import { ConfirmationPanel } from "../components/ConfirmationPanel";
import { TextInputPrompt } from "../components/TextInputPrompt";
import { listPublicConnections, getResolvedConnection, renameConnection, duplicateConnection, removeConnection } from "../../core/db/db-cache";
import { testConnectionProfile } from "../../core/db/db-connection";
import type { InkInteractionService } from "../services/ink-interaction-service";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };
type TAction = "list" | "test" | "info" | "rename" | "duplicate" | "remove";
type TStep = { kind: "menu" } | { kind: "pick-connection"; action: TAction } | { kind: "rename-input"; connectionId: string } | { kind: "remove-confirm"; connectionId: string };

/**
 * Native `cf db connections`: the traditional handler is a `for(;;)` menu
 * loop — reproduced here as an explicit step state machine instead
 * (menu -> pick connection -> act -> back to menu), since Ink has no
 * blocking loop construct. `list`/`info` are read-only; `test` connects to
 * the real database; `rename`/`duplicate`/`remove` mutate the cached
 * connection profile for real, same as the traditional command.
 */
export function CfDbConnectionsScreen(props: TScreenProps) {
  const [step, setStep] = useState<TStep>({ kind: "menu" });
  const [connections, setConnections] = useState<Awaited<ReturnType<typeof listPublicConnections>> | undefined>(undefined);
  const [refreshKey, setRefreshKey] = useState(0);
  const busyRef = useRef(false);

  useEffect(() => {
    void listPublicConnections().then(setConnections);
  }, [refreshKey]);

  const back = () => setStep({ kind: "menu" });
  const refreshAndBack = () => {
    setRefreshKey((current) => current + 1);
    back();
  };

  async function runAction(action: TAction, connectionId: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (action === "test") {
        const resolved = await getResolvedConnection(connectionId);
        const result = await testConnectionProfile(resolved);
        props.service.notify({
          level: result.success ? "success" : "error",
          message: result.success ? `OK (${result.serverVersion ?? ""}) in ${result.durationMs}ms` : `Failed: ${result.message}`,
        });
      } else if (action === "info") {
        const connection = connections?.find((item) => item.id === connectionId);
        if (connection) {
          props.service.notify({ level: "muted", message: JSON.stringify(connection, null, 2) });
        }
      } else if (action === "duplicate") {
        const copy = await duplicateConnection(connectionId);
        props.service.notify({ level: "success", message: `Duplicated as: ${copy.name}` });
      } else if (action === "remove") {
        await removeConnection(connectionId);
        props.service.notify({ level: "success", message: "Removed." });
      }
    } finally {
      busyRef.current = false;
      refreshAndBack();
    }
  }

  if (step.kind === "menu") {
    if (!connections) return <Text dimColor>Loading connections…</Text>;
    if (connections.length === 0) {
      return <Text color="yellow">No DB connections cached. Run `cf db import` first. Press Enter to dismiss.</Text>;
    }

    return (
      <SearchableList
        message="DB connections"
        choices={[
          { title: "List connections", value: "list" },
          { title: "Test connection", value: "test" },
          { title: "Show connection info (no password)", value: "info" },
          { title: "Rename connection", value: "rename" },
          { title: "Duplicate connection", value: "duplicate" },
          { title: "Remove connection", value: "remove" },
        ]}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={(value) => {
          const action = value as TAction;
          if (action === "list") {
            for (const connection of connections) {
              props.service.notify({
                level: "muted",
                message: `${connection.name} · ${connection.type} · ${connection.host}:${connection.port} · ${connection.org ?? "-"}/${connection.space ?? "-"} · app=${connection.app ?? "-"}`,
              });
            }
            return; // stays on the menu, matching the traditional handler's loop
          }
          setStep({ kind: "pick-connection", action });
        }}
        onCancel={() => props.onDone(true)}
      />
    );
  }

  if (step.kind === "pick-connection") {
    return (
      <SearchableList
        message={`Select connection${step.action === "rename" ? " to rename" : step.action === "remove" ? " to remove" : ""}`}
        choices={(connections ?? []).map((connection) => ({ title: `${connection.name} · ${connection.type} · ${connection.host}`, value: connection.id }))}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={(connectionId) => {
          if (step.action === "rename") {
            setStep({ kind: "rename-input", connectionId });
          } else if (step.action === "remove") {
            setStep({ kind: "remove-confirm", connectionId });
          } else {
            void runAction(step.action, connectionId);
          }
        }}
        onCancel={back}
      />
    );
  }

  if (step.kind === "rename-input") {
    return (
      <TextInputPrompt
        message="New name"
        validate={(value) => (value.trim() ? true : "Value is required")}
        onSubmit={async (value) => {
          await renameConnection(step.connectionId, value.trim());
          props.service.notify({ level: "success", message: "Renamed." });
          refreshAndBack();
        }}
        onCancel={back}
      />
    );
  }

  if (step.kind === "remove-confirm") {
    return (
      <ConfirmationPanel
        message="Remove this connection?"
        initial={false}
        onSubmit={(confirmed) => (confirmed ? void runAction("remove", step.connectionId) : back())}
        onCancel={back}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}
