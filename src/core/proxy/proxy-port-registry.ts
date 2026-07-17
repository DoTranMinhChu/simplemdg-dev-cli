import { execSync } from "node:child_process";
import { isPortAvailable } from "../studio-shared/studio-server-kit";
import type { TProxyPortInfo } from "./proxy-types";

type TPortOwner = { ownerId: string; ownerName: string; type: "environment" | "quick-proxy" };

/**
 * Every proxy port bound by THIS process — since forwarder + capture + refresh all live
 * in one process now (unlike ProxyHub's dashboard+proxy split), a single in-memory map is
 * enough; there is no cross-process `/api/ports/status` call to make.
 */
const boundPorts = new Map<number, TPortOwner>();

export function registerBoundPort(port: number, owner: TPortOwner): void {
  boundPorts.set(port, owner);
}

export function unregisterBoundPort(port: number): void {
  boundPorts.delete(port);
}

export function findRunningPortOwner(port: number): TPortOwner | null {
  return boundPorts.get(port) ?? null;
}

export function listBoundPorts(): TProxyPortInfo[] {
  return Array.from(boundPorts.entries())
    .map(([port, owner]) => ({ port, ownerId: owner.ownerId, ownerName: owner.ownerName, type: owner.type }))
    .sort((a, b) => a.port - b.port);
}

const PORT_SCAN_START = 3010;
const PORT_SCAN_END = 3999;

/** `reservedPorts` are ports configured for OTHER environments that aren't running right now. */
export async function findNextFreeProxyPort(reservedPorts: Iterable<number> = []): Promise<number> {
  const reserved = new Set(reservedPorts);
  for (const port of boundPorts.keys()) reserved.add(port);

  for (let port = PORT_SCAN_START; port <= PORT_SCAN_END; port += 1) {
    if (reserved.has(port)) continue;
    if (await isPortAvailable(port)) return port;
  }

  throw new Error(`No free port found between ${PORT_SCAN_START} and ${PORT_SCAN_END}.`);
}

/** Best-effort EADDRINUSE recovery: find and kill whatever OS process is holding `port`. */
export function killProcessUsingPort(port: number, onLog?: (line: string) => void): void {
  const log = onLog ?? ((): void => undefined);

  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: "utf8" });
      const lines = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const pids = new Set<number>();

      for (const line of lines) {
        // Example: TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    12345
        const parts = line.split(/\s+/);
        const stateOrRemote = parts[3] ?? "";
        const pid = Number(parts[parts.length - 1]);
        if (!Number.isNaN(pid) && pid > 0 && stateOrRemote.toUpperCase().includes("LISTEN")) {
          pids.add(pid);
        }
      }

      for (const pid of pids) {
        log(`Port ${port} is busy. Killing PID ${pid}...`);
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
        } catch {
          // ignore individual kill failures
        }
      }
      return;
    }

    // macOS/Linux fallback.
    const pidText = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
    if (pidText) {
      for (const pidLine of pidText.split(/\r?\n/)) {
        const pid = Number(pidLine.trim());
        if (!Number.isNaN(pid) && pid > 0) {
          log(`Port ${port} is busy. Killing PID ${pid}...`);
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // ignore individual kill failures
          }
        }
      }
    }
  } catch {
    log(`Unable to inspect process on port ${port}.`);
  }
}
