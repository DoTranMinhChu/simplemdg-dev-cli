import { runGitNexus, type TGitNexusCliResult } from "./gitnexus-cli-client";

export type TNexusCodingAgent = "claude" | "codex" | "cursor" | "opencode" | "antigravity";

/**
 * GitNexus's own `setup`/`uninstall` commands handle agent configuration
 * natively (confirmed by spike: `--coding-agent` accepts
 * cursor/claude/antigravity/opencode/codex) — for Claude Code this also
 * installs PreToolUse hooks and bundled skill files, not just an MCP
 * registration. This CLI deliberately does NOT reimplement that itself
 * (unlike plugin-mcp.ts's own `claude mcp add` for this repo's bundled
 * plugins) — GitNexus's installer is the source of truth for what it needs,
 * and duplicating it here would drift out of sync with GitNexus's own future
 * changes. Both Claude Code and Codex are first-class, not experimental.
 */
export async function configureCodingAgent(agent: TNexusCodingAgent, cwd?: string): Promise<TGitNexusCliResult> {
  return runGitNexus(["setup", "--coding-agent", agent], { cwd });
}

/** Reverses `configureCodingAgent` — removes GitNexus's MCP entry, hooks, and skills for one agent. */
export async function removeCodingAgentConfig(agent: TNexusCodingAgent, cwd?: string): Promise<TGitNexusCliResult> {
  return runGitNexus(["uninstall", "--coding-agent", agent], { cwd });
}
