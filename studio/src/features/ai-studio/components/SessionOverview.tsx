import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { EmptyState } from "../../../components/common/EmptyState";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { useAiStudioStore } from "../state/ai-studio-store";
import type { TAiSession, TSessionAnalysis } from "../../../api/ai-studio-api-types";

function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function outcomeLabel(outcome: string): string {
  return outcome.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function outcomeBadgeClass(outcome: string): string {
  if (outcome === "successful") return "badge on";
  if (outcome === "partially-successful") return "badge prod";
  if (outcome === "failed") return "badge prod";
  return "badge";
}

function verificationIcon(status: string): React.ReactElement {
  if (status === "pass") return <span style={{ color: "var(--green)" }}>✓</span>;
  if (status === "fail") return <span style={{ color: "var(--red)" }}>✗</span>;
  if (status === "partial") return <span style={{ color: "var(--amber)" }}>⚠</span>;
  return <span style={{ color: "var(--faint)" }}>?</span>;
}

export function SessionOverview({ session, analysis }: { session: TAiSession; analysis: TSessionAnalysis }): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [score, setScore] = useState(session.userScore);

  const rate = async (value: "good" | "bad"): Promise<void> => {
    await aiStudioApi.setScore(session.id, value);
    setScore(value);
    toast(`Marked as ${value}`);
  };

  return (
    <div>
      <div className="crumbs">
        <span>{session.provider === "claude" ? "Claude Code" : session.provider === "codex" ? "Codex" : session.provider}</span>
        <span className="sep">›</span>
        <span>{session.project}</span>
        {session.gitBranch ? (
          <>
            <span className="sep">›</span>
            <span>{session.gitBranch}</span>
          </>
        ) : null}
      </div>

      <div className="ai-card">
        <h2 style={{ margin: "0 0 6px" }}>{session.title}</h2>

        <div className="kvs" style={{ marginBottom: 16 }}>
          <div className="k">Duration</div>
          <div>{formatDuration(session.durationMs)}</div>
          <div className="k">Tokens</div>
          <div>
            {(session.inputTokens + session.outputTokens).toLocaleString()} ({session.inputTokens.toLocaleString()} in / {session.outputTokens.toLocaleString()} out)
            {session.cacheReadTokens ? ` · ${session.cacheReadTokens.toLocaleString()} cache-read` : ""}
          </div>
          <div className="k">Turns</div>
          <div>{session.turnCount}</div>
          <div className="k">Tool calls</div>
          <div>{session.toolCallCount}</div>
          <div className="k">Errors</div>
          <div>{session.errorCount}</div>
          <div className="k">Model</div>
          <div>{session.model || "unknown"}</div>
        </div>

        <div className="row" style={{ alignItems: "center", gap: 10 }}>
          <span className={outcomeBadgeClass(analysis.outcome)}>{outcomeLabel(analysis.outcome)}</span>
          <span className="note">derived from observed verification evidence below — not from the assistant's own claims</span>
        </div>
      </div>

      <div className="ai-card">
        <h3>Outcome evidence</h3>
        {analysis.outcomeEvidence.length ? (
          <ul>
            {analysis.outcomeEvidence.map((evidence, index) => (
              <li key={index}>{evidence}</li>
            ))}
          </ul>
        ) : (
          <EmptyState>No evidence captured.</EmptyState>
        )}
      </div>

      <div className="ai-card">
        <h3>Verification</h3>
        {analysis.verification.length ? (
          <div className="kvs">
            {analysis.verification.map((check, index) => (
              <div key={index} style={{ display: "contents" }}>
                <div className="k">{check.label}</div>
                <div>
                  {verificationIcon(check.status)} {check.status}
                  {check.durationMs ? ` · ${formatDuration(check.durationMs)}` : ""}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No typecheck/build/test/lint commands were observed in this session.</EmptyState>
        )}
      </div>

      <div className="ai-card">
        <h3>Errors ({analysis.errorGroups.length} groups)</h3>
        {analysis.errorGroups.length ? (
          analysis.errorGroups.map((group, index) => (
            <div key={index} className="errbox" style={{ marginBottom: 8 }}>
              <b>{group.category}</b> · {group.count}x{group.affectedTurnIndexes.length ? ` · turns ${group.affectedTurnIndexes.join(", ")}` : ""}
              <div className="note" style={{ marginTop: 3 }}>
                {group.message}
              </div>
            </div>
          ))
        ) : (
          <EmptyState>No tool-reported errors.</EmptyState>
        )}
      </div>

      <div className="ai-card">
        <h3>Files affected ({analysis.fileImpact.length})</h3>
        {analysis.fileImpact.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th>Path</th>
                <th className="num">Reads</th>
                <th className="num">Edits</th>
              </tr>
            </thead>
            <tbody>
              {analysis.fileImpact.slice(0, 100).map((file) => (
                <tr key={file.path}>
                  <td title={file.path}>{file.path}</td>
                  <td className="num">{file.reads}</td>
                  <td className="num">{file.edits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState>No file reads/edits detected.</EmptyState>
        )}
      </div>

      <div className="ai-card">
        <h3>Tool usage</h3>
        {analysis.toolUsage.length ? (
          <table className="grid">
            <thead>
              <tr>
                <th>Tool</th>
                <th className="num">Calls</th>
                <th className="num">Time</th>
                <th className="num">Errors</th>
              </tr>
            </thead>
            <tbody>
              {analysis.toolUsage.slice(0, 30).map((tool) => (
                <tr key={tool.name}>
                  <td>{tool.name}</td>
                  <td className="num">{tool.callCount}</td>
                  <td className="num">{formatDuration(tool.totalDurationMs)}</td>
                  <td className="num">{tool.errorCount || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState>No tool calls recorded.</EmptyState>
        )}
      </div>

      {analysis.commandsRun.length ? (
        <div className="ai-card">
          <h3>Commands run</h3>
          <pre className="cell-pre wrap">{analysis.commandsRun.slice(0, 50).join("\n")}</pre>
        </div>
      ) : null}

      <div className="row" style={{ gap: 8, marginTop: 10, marginBottom: 20 }}>
        <span className="note">Rate this session:</span>
        <Button size="sm" variant={score === "good" ? "primary" : "ghost"} onClick={() => rate("good")}>
          👍 Good
        </Button>
        <Button size="sm" variant={score === "bad" ? "danger" : "ghost"} onClick={() => rate("bad")}>
          👎 Bad
        </Button>
        <span className="grow" />
        <a className="link" href={aiStudioApi.exportUrl(session.id)} target="_blank" rel="noopener noreferrer">
          Export Markdown
        </a>
      </div>
    </div>
  );
}
