import { useEffect, useRef, useState } from "react";
import type { StreamingSessionService, TStreamLine, TStreamingStatus } from "../services/streaming-session-service";

// A chatty log tail can emit many lines per second; coalescing into one
// re-render per window keeps Ink's cursor-based redraw from thrashing.
const COALESCE_MS = 75;

export type TStreamingSnapshot = {
  lines: TStreamLine[];
  truncatedCount: number;
  status: TStreamingStatus;
  exitCode: number | undefined;
};

export function useStreamingSession(service: StreamingSessionService): TStreamingSnapshot {
  const [snapshot, setSnapshot] = useState<TStreamingSnapshot>(() => service.getSnapshot());
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setSnapshot(service.getSnapshot());

    const scheduleSync = () => {
      if (timerRef.current) {
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        setSnapshot(service.getSnapshot());
      }, COALESCE_MS);
    };

    const onStatusChange = () => setSnapshot(service.getSnapshot());

    service.on("line", scheduleSync);
    service.on("status-change", onStatusChange);

    return () => {
      service.off("line", scheduleSync);
      service.off("status-change", onStatusChange);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [service]);

  return snapshot;
}
