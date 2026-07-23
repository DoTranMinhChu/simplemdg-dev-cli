import { useEffect, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { useJobEvents, mergeJobSteps } from "../hooks/useJobEvents";
import type { TJobStep } from "../hooks/useJobEvents";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TDeployModelResult, TMrLiveStatus } from "../api/tool-studio-api-client";

const POLL_INTERVAL_MS = 6000;

// GitLab pipeline statuses mapped onto the shared `.status-badge` color set (see globals.css) —
// reusing it rather than inventing new colors keeps this visually consistent with every other
// "badge" in the app (AI Studio's repo/agent status pills use the same classes).
const PIPELINE_STATUS_CLASS: Record<string, string> = {
  success: "ready",
  running: "analyzing",
  pending: "starting",
  created: "starting",
  preparing: "starting",
  scheduled: "starting",
  waiting_for_resource: "starting",
  manual: "browser-auth",
  failed: "failed",
  canceled: "stopped",
  skipped: "stopped",
};

const PIPELINE_STATUS_ICON: Record<string, string> = {
  success: "✓",
  failed: "✗",
};

/** GitLab-style pipeline status pill, linking straight to the pipeline on GitLab — the whole point
 * being the user doesn't have to open GitLab just to see whether the build passed. */
function PipelineBadge({ pipeline }: { pipeline: { id: number; status: string; webUrl: string } }): React.ReactElement {
  const badgeClass = PIPELINE_STATUS_CLASS[pipeline.status] ?? "stopped";
  const icon = PIPELINE_STATUS_ICON[pipeline.status];
  return (
    <a href={pipeline.webUrl} target="_blank" rel="noreferrer" className={`status-badge ${badgeClass}`} style={{ textDecoration: "none" }} title="Open pipeline in GitLab">
      {icon ? icon : <Spinner />} Pipeline #{pipeline.id} · {pipeline.status}
    </a>
  );
}

function MergeRequestRow({ mr }: { mr: TDeployModelResult["mergeRequests"][number] }): React.ReactElement {
  const [status, setStatus] = useState<TMrLiveStatus | undefined>();
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const result = await toolStudioApi.getMrStatus(mr.projectId, mr.iid).catch(() => undefined);
      if (!cancelled && result && !result.error) setStatus(result);
    };
    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [mr.projectId, mr.iid]);

  const isMerged = status?.state === "merged";

  return (
    <div className={`ts-step-row ${isMerged ? "success" : ""}`}>
      <span className="ts-step-icon">{isMerged ? "✓" : "–"}</span>
      <div style={{ flex: 1 }}>
        <div>
          <a href={mr.webUrl} target="_blank" rel="noreferrer">{mr.pathWithNamespace} — MR</a>
        </div>
        <div className="ts-step-detail row" style={{ gap: 6, alignItems: "center" }}>
          <span>{status ? status.state : "checking status..."}</span>
          {status?.pipeline && (
            <>
              <span>· on {mr.targetBranch}:</span>
              <PipelineBadge pipeline={status.pipeline} />
            </>
          )}
        </div>
        {mergeError && <div className="ts-step-detail" style={{ color: "var(--red)" }}>{mergeError}</div>}
      </div>
      {!isMerged && (
        <Button
          size="sm"
          variant="sec"
          disabled={merging}
          onClick={async () => {
            setMerging(true);
            setMergeError(undefined);
            const result = await toolStudioApi.mergeMr(mr.projectId, mr.iid);
            setMerging(false);
            if (result.error) setMergeError(result.error);
            const refreshed = await toolStudioApi.getMrStatus(mr.projectId, mr.iid).catch(() => undefined);
            if (refreshed && !refreshed.error) setStatus(refreshed);
          }}
        >
          {merging ? <Spinner /> : "Merge"}
        </Button>
      )}
    </div>
  );
}

/**
 * Shows each deploy's MRs with live-polled merge/pipeline status and a manual "Merge" button — no
 * need to open GitLab just to click merge or watch the build. "Auto-merge" automates the user's own
 * usual sequence (merge `db`, wait for the pipeline its merge commit triggers on the target branch,
 * only then merge `srv`/`srv_process`) — it's a convenience on top of the manual buttons, not a
 * replacement: every MR can still be merged by hand, in any order, whether or not auto-merge ran.
 */
export function MergeRequestsPanel({ mergeRequests }: { mergeRequests: TDeployModelResult["mergeRequests"] }): React.ReactElement {
  const [autoMergeJobId, setAutoMergeJobId] = useState<string | undefined>();
  const [autoMergeSteps, setAutoMergeSteps] = useState<TJobStep[]>([]);
  const [autoMergeError, setAutoMergeError] = useState<string | undefined>();
  const [starting, setStarting] = useState(false);
  const autoMergeRunning = useRef(false);

  useJobEvents(autoMergeJobId, (event) => {
    if (event.type === "job-step" && event.steps) setAutoMergeSteps((prev) => mergeJobSteps(prev, event.steps!));
    if (event.type === "job-completed") autoMergeRunning.current = false;
    if (event.type === "job-failed") {
      autoMergeRunning.current = false;
      setAutoMergeError(event.error);
    }
  });

  const dbTarget = mergeRequests.find((mr) => mr.role === "db");
  const restTargets = mergeRequests.filter((mr) => mr.role !== "db");

  return (
    <div style={{ marginTop: 12 }}>
      {mergeRequests.map((mr) => (
        <MergeRequestRow key={mr.webUrl} mr={mr} />
      ))}

      {dbTarget && (
        <div style={{ marginTop: 8 }}>
          <Button
            variant="sec"
            size="sm"
            disabled={starting || autoMergeRunning.current}
            onClick={async () => {
              setStarting(true);
              setAutoMergeSteps([]);
              setAutoMergeError(undefined);
              const result = await toolStudioApi.startAutoMerge(
                { role: dbTarget.role, pathWithNamespace: dbTarget.pathWithNamespace, projectId: dbTarget.projectId, mrIid: dbTarget.iid, targetBranch: dbTarget.targetBranch },
                restTargets.map((mr) => ({ role: mr.role, pathWithNamespace: mr.pathWithNamespace, projectId: mr.projectId, mrIid: mr.iid, targetBranch: mr.targetBranch })),
              );
              setStarting(false);
              if (result.jobId) {
                autoMergeRunning.current = true;
                setAutoMergeJobId(result.jobId);
              } else if (result.error) {
                setAutoMergeError(result.error);
              }
            }}
          >
            {starting ? <Spinner /> : `Auto-merge: ${dbTarget.role} → wait for build → the rest`}
          </Button>

          {autoMergeSteps.length > 0 && (
            <div className="ts-result" style={{ marginTop: 8 }}>
              {autoMergeSteps.map((step) => (
                <div className={`ts-step-row ${step.status === "running" ? "" : step.status}`} key={step.key}>
                  <span className="ts-step-icon">{step.status === "running" ? <Spinner /> : step.status === "success" ? "✓" : step.status === "failed" ? "✗" : "–"}</span>
                  <div>
                    <div>{step.label}</div>
                    {step.detail && <div className="ts-step-detail">{step.detail}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {autoMergeError && <div className="errbox" style={{ marginTop: 8 }}>{autoMergeError}</div>}
        </div>
      )}
    </div>
  );
}
