import { runCommand } from "../process";
import { isCommandAvailable } from "../tooling";

export type TGitNexusInvocation = { command: string; baseArgs: string[] };

let cachedInvocation: TGitNexusInvocation | undefined;

/**
 * Resolve how to run GitNexus: a global/local install on PATH first, falling
 * back to npx (same convention as this CLI's other npx-spawned MCP servers,
 * e.g. plugin-mcp.ts's stdio branch). GitNexus is intentionally never added
 * to this repo's own package.json — see the project's licensing note
 * (PolyForm-Noncommercial) — so npx is the expected path for most users.
 * `SMDG_GITNEXUS_BIN` is an escape hatch for local development against an
 * unpublished/linked build.
 *
 * The npx fallback resolves `gitnexus@latest` to an exact version ONCE (a
 * one-time registry round-trip, confirmed by measurement to add several
 * seconds), then pins every subsequent call in this process to that exact
 * version (`gitnexus@1.6.9`, say) instead of the floating `@latest` tag —
 * npx serves an already-cached exact version straight from its local package
 * cache with no network round-trip, while `@latest` re-checks the registry on
 * every single invocation. Confirmed during implementation: this is what was
 * making every Nexus action (Overview, Search, Change Impact, ...) take
 * 7-15+ seconds each even once GitNexus was fully set up.
 */
export async function resolveGitNexusInvocation(): Promise<TGitNexusInvocation> {
  if (cachedInvocation) return cachedInvocation;

  const override = process.env.SMDG_GITNEXUS_BIN;
  if (override) {
    cachedInvocation = { command: override, baseArgs: [] };
    return cachedInvocation;
  }

  if (await isCommandAvailable("gitnexus")) {
    cachedInvocation = { command: "gitnexus", baseArgs: [] };
    return cachedInvocation;
  }

  const probe = await runCommand("npx", ["-y", "gitnexus@latest", "--version"], { reject: false });
  const version = probe.exitCode === 0 ? probe.stdout.trim() : undefined;

  cachedInvocation = { command: "npx", baseArgs: ["-y", version ? `gitnexus@${version}` : "gitnexus@latest"] };
  return cachedInvocation;
}

/** Test-only: clear the cached invocation so a test can force re-resolution. */
export function resetGitNexusInvocationCache(): void {
  cachedInvocation = undefined;
}

export type TGitNexusVersionCheckReason = "not-found" | "network" | "unknown";

export type TGitNexusVersionCheck =
  | { installed: true; version: string }
  | { installed: false; reason: TGitNexusVersionCheckReason; detail: string };

/** `gitnexus --version` (or the npx equivalent, which also confirms network/registry access). */
export async function getGitNexusVersion(): Promise<TGitNexusVersionCheck> {
  const invocation = await resolveGitNexusInvocation();
  const result = await runCommand(invocation.command, [...invocation.baseArgs, "--version"], { reject: false });

  if (result.exitCode === 0 && result.stdout.trim()) {
    return { installed: true, version: result.stdout.trim() };
  }

  const detail = (result.stderr || result.stdout).trim();
  const reason: TGitNexusVersionCheckReason =
    invocation.command === "npx" && /ENOTFOUND|network|fetch failed|timed? ?out|getaddrinfo/i.test(detail)
      ? "network"
      : invocation.command === "npx"
        ? "unknown"
        : "not-found";

  return { installed: false, reason, detail: detail || `exit code ${result.exitCode}` };
}
