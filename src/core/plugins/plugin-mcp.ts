import { runCommand } from "../process";
import type { TInstallScope, TMcpServerSpec } from "./plugin-types";

function raiseAddFailure(name: string, result: { exitCode: number; stderr: string; stdout: string }): never {
  throw new Error(`Failed to register MCP server "${name}": ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
}

/**
 * Registers one MCP server via `claude mcp add`. Returns whether this call actually created a new
 * registration (`registered: true`) or found one already present and left it untouched
 * (`registered: false`) — callers use this to decide what's safe to roll back on a later failure
 * vs. what must still be tracked in persisted plugin state (see `plugin-installer.ts`).
 */
export async function addMcpServer(spec: TMcpServerSpec, scope: TInstallScope): Promise<{ registered: boolean }> {
  if (spec.transport === "http") {
    // Never remove-then-re-add an http (typically OAuth-authenticated) server: `claude mcp remove`
    // may revoke its cached auth session, which would force the user to re-authenticate on every
    // `smdg plugin update`/reinstall — exactly the friction a hosted-auth MCP server exists to avoid.
    // Only register when genuinely absent; an existing registration is left completely alone.
    const existing = await listMcpServers();
    if (existing.includes(spec.name)) {
      return { registered: false };
    }

    // No "--" downstream command here (unlike the stdio branch below), so the win32 argv-parser
    // quirk documented there doesn't apply — these tokens go straight to `claude`'s own parser,
    // which already handles dash-prefixed tokens like "-s" fine before any "--".
    const result = await runCommand("claude", ["mcp", "add", "--transport", "http", spec.name, "-s", scope, spec.url]);
    if (result.exitCode !== 0) raiseAddFailure(spec.name, result);
    return { registered: true };
  }

  // `spec` is narrowed to the stdio member here (transport !== "http"), so `package`/`args` are guaranteed.
  const command = "npx";
  const args = ["-y", spec.package, ...spec.args];

  // Remove-then-add makes registration idempotent (mirrors the original manual setup script),
  // so re-running install/update for an already-registered server never errors on "already exists".
  // Safe for stdio servers: there's no persistent auth session tied to the registration itself.
  await runCommand("claude", ["mcp", "remove", spec.name, "-s", scope]);

  const addArgs =
    process.platform === "win32"
      ? // win32: `claude mcp add`'s own argv parser trips on dash-prefixed tokens ("-y", "--browser")
        // appearing as separate argv entries after "--", even though "--" is supposed to stop its
        // option parsing. Routing the whole downstream command through `cmd /c "<single string>"` means
        // `claude` only ever sees one non-dash-prefixed token post-"--", and cmd.exe re-splits it
        // downstream correctly. (Documented workaround, carried over from the original manual setup.)
        ["mcp", "add", spec.name, "-s", scope, "--", "cmd", "/c", [command, ...args].join(" ")]
      : // darwin/linux: no such parser quirk — invoke the downstream command directly.
        ["mcp", "add", spec.name, "-s", scope, "--", command, ...args];

  const result = await runCommand("claude", addArgs);
  if (result.exitCode !== 0) raiseAddFailure(spec.name, result);
  return { registered: true };
}

export async function removeMcpServer(name: string, scope: TInstallScope): Promise<void> {
  await runCommand("claude", ["mcp", "remove", name, "-s", scope]);
}

/** Raw `claude mcp list` output, for membership checks (`plugin-doctor`) — one shell-out covers every installed server rather than one call per server. */
export async function listMcpServers(): Promise<string> {
  const result = await runCommand("claude", ["mcp", "list"]);
  return result.stdout;
}
