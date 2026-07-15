import { runCommand } from "../process";
import type { TInstallScope, TMcpServerSpec } from "./plugin-types";

function downstreamCommand(spec: TMcpServerSpec): { command: string; args: string[] } {
  return { command: "npx", args: ["-y", spec.package, ...spec.args] };
}

/**
 * Registers one MCP server via `claude mcp add`, branching on platform:
 * - win32: `claude mcp add`'s own argv parser trips on dash-prefixed tokens ("-y", "--browser")
 *   appearing as separate argv entries after "--", even though "--" is supposed to stop its
 *   option parsing. Routing the whole downstream command through `cmd /c "<single string>"` means
 *   `claude` only ever sees one non-dash-prefixed token post-"--", and cmd.exe re-splits it
 *   downstream correctly. (Documented workaround, carried over from the original manual setup.)
 * - darwin/linux: no such parser quirk — invoke the downstream command directly.
 */
export async function addMcpServer(spec: TMcpServerSpec, scope: TInstallScope): Promise<void> {
  const { command, args } = downstreamCommand(spec);

  // Remove-then-add makes registration idempotent (mirrors the original manual setup script),
  // so re-running install/update for an already-registered server never errors on "already exists".
  await runCommand("claude", ["mcp", "remove", spec.name, "-s", scope]);

  const addArgs =
    process.platform === "win32"
      ? ["mcp", "add", spec.name, "-s", scope, "--", "cmd", "/c", [command, ...args].join(" ")]
      : ["mcp", "add", spec.name, "-s", scope, "--", command, ...args];

  const result = await runCommand("claude", addArgs);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to register MCP server "${spec.name}": ${result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`}`);
  }
}

export async function removeMcpServer(name: string, scope: TInstallScope): Promise<void> {
  await runCommand("claude", ["mcp", "remove", name, "-s", scope]);
}

/** Raw `claude mcp list` output, for membership checks (`plugin-doctor`) — one shell-out covers every installed server rather than one call per server. */
export async function listMcpServers(): Promise<string> {
  const result = await runCommand("claude", ["mcp", "list"]);
  return result.stdout;
}
