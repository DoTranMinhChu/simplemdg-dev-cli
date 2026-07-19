import { execa } from "execa";
import { findAvailablePort } from "../studio-shared/studio-server-kit";
import { resolveGitNexusInvocation } from "./gitnexus-runtime";

const DEFAULT_GITNEXUS_SERVE_PORT = 4747;
const HEALTH_TIMEOUT_MS = 1500;
const START_TIMEOUT_MS = 20000;
const POLL_INTERVAL_MS = 400;

/**
 * "localhost", not the "127.0.0.1" literal — confirmed during implementation that GitNexus's
 * `serve` ends up bound to the IPv6 loopback (`::1`) in this environment even with its documented
 * default `--host 127.0.0.1`, so a literal-IPv4 connection attempt is refused while "localhost"
 * (which this environment's DNS resolves to `::1` first) succeeds. Same quirk observed earlier
 * with plain `curl` against a manually-started `gitnexus serve`.
 */
function gitNexusServeUrl(port: number): string {
  return `http://localhost:${port}`;
}

async function isGitNexusServeHealthy(port: number): Promise<boolean> {
  try {
    const response = await fetch(`${gitNexusServeUrl(port)}/api/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

export type TGitNexusServeResult = { ok: true; url: string; alreadyRunning: boolean } | { ok: false; message: string };

/** Tracked only for repos we spawned ourselves in this process — lets `restartGitNexusServeIfWeOwnIt` recover from stale-cache-after-re-analyze without touching a `serve` instance some other process/user started (no PID to kill there, so that case is left as a documented manual-restart limitation). */
let ownedProcess: { pid: number; port: number } | undefined;

/**
 * Launches (or reuses) GitNexus's own persistent local server. Originally
 * added only for the "Advanced: full graph view" escape hatch, but also now
 * the backend for the fast Search path (`gitnexus-serve-client.ts`) — a
 * one-off `gitnexus <command>` CLI spawn per request pays GitNexus's own
 * native-binding startup cost (measured at 10-15+ seconds, unaffected by npx
 * version pinning) every single time, while this persistent process answers
 * in well under a second once running.
 */
export async function ensureGitNexusServeRunning(): Promise<TGitNexusServeResult> {
  if (await isGitNexusServeHealthy(DEFAULT_GITNEXUS_SERVE_PORT)) {
    return { ok: true, url: gitNexusServeUrl(DEFAULT_GITNEXUS_SERVE_PORT), alreadyRunning: true };
  }

  let invocation;
  try {
    invocation = await resolveGitNexusInvocation();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const port = await findAvailablePort(DEFAULT_GITNEXUS_SERVE_PORT);

  try {
    const child = execa(invocation.command, [...invocation.baseArgs, "serve", "--port", String(port)], {
      detached: true,
      stdio: "ignore",
      reject: false,
      // Without this, Windows pops up a visible console window for the detached child — jarring
      // for a background service the user never asked to see. No effect on other platforms.
      windowsHide: true,
    });
    if (child.pid) ownedProcess = { pid: child.pid, port };
    // Outlives this request/process by design — same rationale as the module comment above.
    child.unref();
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isGitNexusServeHealthy(port)) {
      return { ok: true, url: gitNexusServeUrl(port), alreadyRunning: false };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  return { ok: false, message: "GitNexus's local server didn't respond in time. Try again, or run `gitnexus serve` manually." };
}

/**
 * GitNexus's `serve` process doesn't pick up a repo's data changes (e.g. a
 * repair-fts pass, or a fresh re-analyze) until it's restarted — confirmed
 * during implementation: search kept reporting "FTS indexes missing" through
 * an already-running `serve` even after the index was repaired on disk,
 * until that process was killed and a fresh one started. Only restarts a
 * `serve` process THIS backend spawned itself (tracked PID); a `serve`
 * started manually or by a previous run has no tracked PID to kill safely,
 * so that case is left for the user to restart by hand.
 */
export async function restartGitNexusServeIfWeOwnIt(): Promise<void> {
  if (!ownedProcess) return;

  try {
    process.kill(ownedProcess.pid);
  } catch {
    // Already gone — fine, we'll just start a fresh one below.
  }
  ownedProcess = undefined;

  // Give the OS a moment to release the port/db lock before respawning.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await ensureGitNexusServeRunning();
}
