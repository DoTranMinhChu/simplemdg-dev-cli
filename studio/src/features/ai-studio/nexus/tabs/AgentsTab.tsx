import { useState } from "react";
import { Button } from "../../../../components/common/Button";
import { nexusApi } from "../../../../api/nexus-api-client";
import type { TNexusCodingAgent, TNexusRepoSummary } from "../../../../api/nexus-api-types";

const AGENTS: Array<{ id: TNexusCodingAgent; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "cursor", label: "Cursor" },
  { id: "opencode", label: "OpenCode" },
];

export function AgentsTab({ repo, toast }: { repo: TNexusRepoSummary; toast: (message: string, kind?: "ok" | "err" | "warn") => void }): React.ReactElement {
  const [pending, setPending] = useState<TNexusCodingAgent | undefined>();

  const configure = async (agent: TNexusCodingAgent, remove: boolean): Promise<void> => {
    setPending(agent);
    try {
      const result = await nexusApi.configureAgent(agent, { remove, repoPath: repo.path });
      toast(result.message ?? (remove ? `Removed GitNexus from ${agent}.` : `${agent} can now use GitNexus.`), result.status === "error" ? "err" : "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setPending(undefined);
    }
  };

  return (
    <div className="tabpane-scroll">
      <div className="ai-card">
        <h3>Connect an AI coding agent</h3>
        <p className="note">
          Configuring an agent registers GitNexus as an MCP server it can query directly, so it can look up dependencies, callers, and execution flows itself while it works — not just from what you paste in.
          For Claude Code, this also installs a few helper hooks and skills that GitNexus manages on its own.
        </p>
        {AGENTS.map((agent) => (
          <div key={agent.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
            <span>{agent.label}</span>
            <div className="row" style={{ gap: 6 }}>
              <Button size="sm" onClick={() => configure(agent.id, false)} disabled={pending === agent.id}>
                {pending === agent.id ? "Working..." : "Configure"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => configure(agent.id, true)} disabled={pending === agent.id}>
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="ai-card">
        <h3>Privacy</h3>
        <p className="note">
          Analysis runs locally on this machine. Nothing about this repository's code is uploaded anywhere by default. Indexes are stored in a <code>.gitnexus/</code> folder inside the repository, and removing them never touches your source files.
        </p>
      </div>
    </div>
  );
}
