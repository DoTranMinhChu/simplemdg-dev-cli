import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { proxyStudioApi } from "../api/proxy-studio-api-client";
import { useProxyEvents } from "../hooks/useProxyEvents";

type TProgress = { value: number; label: string; error?: boolean };

function splitLines(raw: string): string[] {
  return raw.split(/\r?\n/).filter((line, index, all) => !(index === all.length - 1 && line === ""));
}

function classifyLine(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("failed") || lower.includes("error") || lower.includes("http 401") || lower.includes("unauthorized")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.includes("success") || lower.includes("captured") || lower.includes("ready") || lower.includes("completed")) return "success";
  return "";
}

/** Milestone-based progress, ported from the reference dashboard's `updateLogProgressFromLine`. */
function progressFromLine(line: string, current: number): TProgress | null {
  const lower = line.toLowerCase();
  if (lower.includes("start requested") || lower.includes("starting ")) return { value: 5, label: "Starting..." };
  if (lower.includes("opening target application")) return { value: Math.max(current, 20), label: "Opening target application..." };
  if (lower.includes("captured matching request") || lower.includes("success: headers retrieved")) {
    return { value: Math.max(current, 80), label: "Request captured..." };
  }
  if (lower.includes("reusing recent session") || lower.includes("proxy listening") || lower.includes("proxy ready")) {
    return { value: 100, label: "Completed" };
  }
  if (lower.includes("stopped") || lower.includes("stopping")) return { value: 0, label: "Stopped" };
  if (lower.includes("failed") || lower.includes("refresh failed")) {
    return { value: Math.max(current, 10), label: "Error detected. Check logs.", error: true };
  }
  return null;
}

/** One persistent panel at the bottom of the page, not per-card — click any card to make it
 * the active owner. Ported from the reference dashboard's single always-visible log console
 * with a progress bar, instead of a collapsible per-card log viewer. */
export function LogsConsole({ ownerId, ownerLabel }: { ownerId: string | undefined; ownerLabel: string }): React.ReactElement {
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<TProgress>({ value: 0, label: "Idle" });
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLines([]);
    setProgress({ value: 0, label: ownerId ? "Loading logs..." : "Idle" });
    if (!ownerId) return;

    let cancelled = false;
    void proxyStudioApi.getLogs(ownerId).then((result) => {
      if (cancelled) return;
      const flattened = result.logs.flatMap(splitLines);
      setLines(flattened);

      let value = 0;
      let label = "Idle";
      let hasError = false;
      for (const line of flattened) {
        const update = progressFromLine(line, value);
        if (update) {
          value = update.value;
          label = update.label;
          hasError = Boolean(update.error);
        }
      }
      setProgress({ value, label, error: hasError });
    });

    return () => {
      cancelled = true;
    };
  }, [ownerId]);

  useProxyEvents((event) => {
    if (event.channel !== "log" || event.envId !== ownerId) return;
    const newLines = splitLines(event.line);
    if (newLines.length === 0) return;

    setLines((previous) => [...previous.slice(-999), ...newLines]);
    setProgress((previous) => {
      let next = previous;
      for (const line of newLines) {
        const update = progressFromLine(line, next.value);
        if (update) next = { value: update.value, label: update.label, error: Boolean(update.error) };
      }
      return next;
    });
  });

  useEffect(() => {
    if (autoScroll && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  return (
    <div className="logs-console">
      <div className="logs-console-head">
        <div>
          <strong>Logs</strong>
          <div className="note">{ownerId ? `Showing logs for: ${ownerLabel}` : "No environment selected."}</div>
        </div>
        <div className="row">
          <label className="note" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
            Auto-scroll
          </label>
          <Button variant="ghost" size="sm" onClick={() => setLines([])}>
            Clear Logs
          </Button>
        </div>
      </div>

      <div style={{ padding: "8px 12px" }}>
        <div className="log-progress-track">
          <div className={`log-progress-fill${progress.error ? " error" : ""}`} style={{ width: `${progress.value}%` }} />
        </div>
        <div className="note" style={{ marginTop: 4 }}>{progress.label}</div>
      </div>

      <div className="logs-console-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="note">(no log lines yet)</div>
        ) : (
          lines.map((line, index) => (
            <div key={index} className={`log-line ${classifyLine(line)}`}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
