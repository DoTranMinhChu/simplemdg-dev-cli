import { useMemo, useState } from "react";
import { EmptyState } from "../../../components/common/EmptyState";
import { ShellCommandCard } from "../conversation/ShellCommandCard";
import type { TAiObservation } from "../../../api/ai-studio-api-types";

/** §13 — every shell command in the session, full presentation, newest last (chronological). */
export function CommandsView({ observations, cwd }: { observations: TAiObservation[]; cwd?: string }): React.ReactElement {
  const [query, setQuery] = useState("");
  const commands = useMemo(() => observations.filter((observation) => observation.type === "shell-command"), [observations]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((observation) => observation.input.toLowerCase().includes(q) || observation.output.toLowerCase().includes(q));
  }, [commands, query]);

  if (!commands.length) return <EmptyState>No shell commands recorded.</EmptyState>;

  return (
    <div className="commands-view">
      <input placeholder="Filter commands…" value={query} onChange={(event) => setQuery(event.target.value)} style={{ marginBottom: 10, width: "100%", maxWidth: 360 }} />
      {filtered.map((observation) => (
        <div key={observation.id} style={{ marginBottom: 10 }}>
          <ShellCommandCard observation={observation} cwd={cwd} />
        </div>
      ))}
      {!filtered.length ? <EmptyState>No commands match this filter.</EmptyState> : null}
    </div>
  );
}
