import { useEffect, useRef, useState } from "react";
import { proxyStudioApi } from "../api/proxy-studio-api-client";
import { useProxyEvents } from "../hooks/useProxyEvents";

/** Live log tail for one running owner (an environment id or a quick-proxy id) — fetches scrollback once, then appends live lines from the shared SSE stream. */
export function LogPanel({ ownerId }: { ownerId: string }): React.ReactElement {
  const [lines, setLines] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void proxyStudioApi.getLogs(ownerId).then((result) => {
      if (!cancelled) setLines(result.logs);
    });
    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  useProxyEvents((event) => {
    if (event.channel === "log" && event.envId === ownerId) {
      setLines((previous) => [...previous.slice(-999), event.line]);
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [lines.length]);

  return (
    <pre className="cell-pre" style={{ maxHeight: 260, overflow: "auto", fontSize: 12 }}>
      {lines.length === 0 ? "(no log lines yet)" : lines.join("")}
      <div ref={bottomRef} />
    </pre>
  );
}
