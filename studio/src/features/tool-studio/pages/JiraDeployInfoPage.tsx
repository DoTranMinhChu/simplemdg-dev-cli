import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";

export function JiraDeployInfoPage(): React.ReactElement {
  const [baseUrl, setBaseUrl] = useState("https://laidon.atlassian.net");
  const [email, setEmail] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [issueKey, setIssueKey] = useState("");

  const [worklogHours, setWorklogHours] = useState("1");
  const [worklogComment, setWorklogComment] = useState("");

  const deployInfo = useAsync(() => toolStudioApi.getJiraDeployInfo({ baseUrl, email, apiToken, issueKey }));
  const workLog = useAsync(() =>
    toolStudioApi.postJiraWorkLog({
      baseUrl,
      email,
      apiToken,
      issueKey,
      started: new Date().toISOString(),
      timeSpentSeconds: Math.round(Number(worklogHours) * 3600),
      comment: worklogComment || undefined,
    }),
  );

  return (
    <div>
      <div className="ts-header">
        <h1>Jira Deploy Info</h1>
        <p className="note">Look up a deploy ticket's referenced tickets/subtasks, and log work — credentials are used per-call only, never stored server-side.</p>
      </div>

      <div className="ts-card">
        <div className="ts-grid-2">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Jira base URL</label>
            <input className="input" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </div>
          <div className="field">
            <label>Email</label>
            <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <div className="field">
            <label>API token</label>
            <input className="input" type="password" value={apiToken} onChange={(event) => setApiToken(event.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Issue key</label>
            <input className="input" placeholder="e.g. SMDG-1234" value={issueKey} onChange={(event) => setIssueKey(event.target.value)} />
          </div>
        </div>

        <div className="row">
          <Button onClick={() => void deployInfo.run()} disabled={deployInfo.loading || !issueKey}>
            {deployInfo.loading ? <Spinner /> : "Get deploy info"}
          </Button>
        </div>

        {deployInfo.error && <div className="errbox" style={{ marginTop: 12 }}>{deployInfo.error}</div>}
        {deployInfo.data?.error && <div className="errbox" style={{ marginTop: 12 }}>{deployInfo.data.error}</div>}

        {deployInfo.data?.source && (
          <div style={{ marginTop: 12 }}>
            <div className="ts-step-row success">
              <span className="ts-step-icon">▸</span>
              <div>
                <div>{deployInfo.data.source.key} — {deployInfo.data.source.summary}</div>
                <div className="ts-step-detail">{deployInfo.data.source.status}{deployInfo.data.source.assignee ? ` · ${deployInfo.data.source.assignee}` : ""}</div>
              </div>
            </div>
            {!deployInfo.data.referenced?.length ? (
              <div className="note" style={{ marginTop: 8 }}>No referenced deploy tickets found in the description.</div>
            ) : (
              deployInfo.data.referenced.map((ticket) => (
                <div key={ticket.key} style={{ marginTop: 8 }}>
                  <div className="ts-step-row success">
                    <span className="ts-step-icon">▸</span>
                    <div>
                      <div>{ticket.key} — {ticket.summary}</div>
                      <div className="ts-step-detail">{ticket.status}{ticket.assignee ? ` · ${ticket.assignee}` : ""}</div>
                    </div>
                  </div>
                  {ticket.subtasks.map((subtask) => (
                    <div className="ts-step-row success" key={subtask.key} style={{ marginLeft: 24, marginTop: 4 }}>
                      <span className="ts-step-icon">↳</span>
                      <div>{subtask.key} — {subtask.summary} ({subtask.status})</div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="ts-card" style={{ marginTop: 16 }}>
        <div className="ts-header">
          <h1 style={{ fontSize: "var(--font-size-lg)" }}>Log work</h1>
        </div>
        <div className="ts-grid-2">
          <div className="field">
            <label>Hours</label>
            <input className="input" type="number" step="0.25" value={worklogHours} onChange={(event) => setWorklogHours(event.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Comment (optional)</label>
            <input className="input" value={worklogComment} onChange={(event) => setWorklogComment(event.target.value)} />
          </div>
        </div>
        <div className="row">
          <Button onClick={() => void workLog.run()} disabled={workLog.loading || !issueKey}>
            {workLog.loading ? <Spinner /> : "Log work"}
          </Button>
        </div>
        {workLog.error && <div className="errbox" style={{ marginTop: 12 }}>{workLog.error}</div>}
        {workLog.data && (
          <div className={workLog.data.ok ? "note" : "errbox"} style={{ marginTop: 12 }}>
            {workLog.data.ok ? "Work logged." : workLog.data.error}
          </div>
        )}
      </div>
    </div>
  );
}
