import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { SearchInput } from "../../../components/common/SearchInput";
import { PipelineBadge } from "../components/MergeRequestsPanel";
import { toolStudioApi } from "../api/tool-studio-api-client";
import type { TMyMergeRequest, TMyMergeRequestsScope, TMyMergeRequestsState } from "../api/tool-studio-api-client";

const AUTO_REFRESH_MS = 15000;
const TERMINAL_PIPELINE_STATUSES = new Set(["success", "failed", "canceled", "skipped"]);
/** How many numbered page buttons to show either side of the current page. */
const PAGE_WINDOW = 2;

type TBuildFilter = "all" | "running" | "failed" | "success" | "none";

const MR_STATE_CLASS: Record<string, string> = { opened: "analyzing", merged: "ready", closed: "stopped" };

const BUILD_FILTERS: ReadonlyArray<readonly [TBuildFilter, string, string]> = [
  ["all", "All", "stopped"],
  ["running", "Building", "analyzing"],
  ["failed", "Failed", "failed"],
  ["success", "Passed", "ready"],
  ["none", "No pipeline", "stopped"],
];

function buildBucket(mr: TMyMergeRequest): Exclude<TBuildFilter, "all"> {
  if (!mr.pipeline) return "none";
  if (mr.pipeline.status === "success") return "success";
  if (mr.pipeline.status === "failed") return "failed";
  return TERMINAL_PIPELINE_STATUSES.has(mr.pipeline.status) ? "none" : "running";
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** "took 4m 12s" once finished, "running 3m" while in progress — from GitLab's pipeline created/updated timestamps. */
function pipelineTiming(pipeline: NonNullable<TMyMergeRequest["pipeline"]>): string | undefined {
  if (!pipeline.createdAt) return undefined;
  const start = new Date(pipeline.createdAt).getTime();
  if (TERMINAL_PIPELINE_STATUSES.has(pipeline.status)) {
    return pipeline.updatedAt ? `took ${formatDuration(new Date(pipeline.updatedAt).getTime() - start)}` : undefined;
  }
  return `running ${formatDuration(Date.now() - start)}`;
}

function branchUrl(mr: TMyMergeRequest, branch: string): string {
  return `${mr.projectWebUrl}/-/tree/${encodeURIComponent(branch)}`;
}

/** Multi-line, chat-ready description of one MR — paste into Teams/Slack/Jira and the reader needs nothing else. */
function shareSummary(mr: TMyMergeRequest): string {
  const lines = [
    `${mr.ticketKeys.length ? `[${mr.ticketKeys.join(", ")}] ` : ""}${mr.title}`,
    `Project: ${mr.pathWithNamespace} !${mr.iid}`,
    `Merge: ${mr.sourceBranch} → ${mr.targetBranch} (${mr.state}${mr.mergedBy ? ` by ${mr.mergedBy}` : ""}${mr.mergedAt ? `, ${new Date(mr.mergedAt).toLocaleString()}` : ""})`,
  ];
  if (mr.pipeline) {
    lines.push(`Build: Pipeline #${mr.pipeline.id} — ${mr.pipeline.status}${mr.pipeline.sha ? ` (${mr.pipeline.sha.slice(0, 8)} on ${mr.pipelineRef})` : ""} ${mr.pipeline.webUrl}`);
  } else {
    lines.push("Build: no pipeline");
  }
  for (const job of mr.externalJobs) lines.push(`Jenkins: ${job.name} — ${job.status} ${job.targetUrl}`);
  lines.push(`MR: ${mr.webUrl}`);
  return lines.join("\n");
}

/** One line per MR, Markdown-list shaped — a quick status report for everything currently shown. */
function shareReport(mrs: TMyMergeRequest[]): string {
  return mrs
    .map((mr) => {
      const build = mr.pipeline ? `Pipeline #${mr.pipeline.id} ${mr.pipeline.status} (${mr.pipeline.webUrl})` : "no pipeline";
      return `- ${mr.title} · ${mr.projectName} !${mr.iid} · ${mr.sourceBranch} → ${mr.targetBranch} · ${mr.state} · ${build} · ${mr.webUrl}`;
    })
    .join("\n");
}

function CopyButton({ text, label, title }: { text: string; label: string; title?: string }): React.ReactElement {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="btn ghost sm"
      title={title}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("copied");
        } catch {
          setState("failed");
        }
        window.setTimeout(() => setState("idle"), 1500);
      }}
    >
      {state === "copied" ? "Copied ✓" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

function pageNumbers(current: number, totalPages: number | undefined, hasMore: boolean): number[] {
  const last = totalPages ?? (hasMore ? current + 1 : current);
  const from = Math.max(1, current - PAGE_WINDOW);
  const to = Math.min(last, current + PAGE_WINDOW);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/**
 * The logged-in user's own MRs across every GitLab project, each with the build it triggered —
 * after merge that's the merge commit's pipeline on the target branch (what GitLab's MR page shows
 * as "Pipeline #N running for <sha> on staging"), plus direct links to the Jenkins jobs behind it.
 * Server-side paged (GitLab's own paging); auto-refreshes only while a listed pipeline is still running.
 */
export function MyMergeRequestsPage(): React.ReactElement {
  const [scope, setScope] = useState<TMyMergeRequestsScope>("created_by_me");
  const [state, setState] = useState<TMyMergeRequestsState>("all");
  const [perPage, setPerPage] = useState(20);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [buildFilter, setBuildFilter] = useState<TBuildFilter>("all");
  const [autoRefresh, setAutoRefresh] = useState(true);

  const [items, setItems] = useState<TMyMergeRequest[] | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | undefined>();
  const [totalPages, setTotalPages] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loadedAt, setLoadedAt] = useState<Date | undefined>();
  // Drops a slow response that lands after the filters already changed and a newer load started.
  const requestSeq = useRef(0);

  // Any filter change starts over from page 1 — page N of the old result set means nothing in the new one.
  useEffect(() => setPage(1), [scope, state, perPage, search]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    try {
      const result = await toolStudioApi.listMyMergeRequests({ scope, state, page, perPage, search: search || undefined });
      if (seq !== requestSeq.current) return;
      if (result.error) {
        setError(result.error);
      } else {
        setError(undefined);
        setItems(result.items ?? []);
        setHasMore(Boolean(result.hasMore));
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setLoadedAt(new Date());
      }
    } catch (loadError) {
      if (seq === requestSeq.current) setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [scope, state, page, perPage, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const anyRunning = (items ?? []).some((mr) => buildBucket(mr) === "running");

  useEffect(() => {
    if (!autoRefresh || !anyRunning) return;
    const timer = setTimeout(() => void load(), AUTO_REFRESH_MS);
    return () => clearTimeout(timer);
  }, [autoRefresh, anyRunning, load, loadedAt]);

  const counts = useMemo(() => {
    const result: Record<TBuildFilter, number> = { all: 0, running: 0, failed: 0, success: 0, none: 0 };
    for (const mr of items ?? []) {
      result.all += 1;
      result[buildBucket(mr)] += 1;
    }
    return result;
  }, [items]);

  const visible = (items ?? []).filter((mr) => buildFilter === "all" || buildBucket(mr) === buildFilter);
  const lastPage = totalPages ?? (hasMore ? undefined : page);

  return (
    <div>
      <div className="ts-header">
        <h1>My Merge Requests</h1>
        <p className="note">
          Your GitLab MRs across every project, with the build each one triggered — after merge, the merge commit's pipeline on the target branch (and its Jenkins jobs).
        </p>
      </div>

      <div className="ts-card">
        <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <SearchInput
            value={searchDraft}
            onChange={(value) => {
              setSearchDraft(value);
              if (!value) setSearch("");
            }}
            onEnter={() => setSearch(searchDraft.trim())}
            placeholder="Search title or ticket…"
          />
          <select className="input" style={{ width: 160 }} value={scope} onChange={(event) => setScope(event.target.value as TMyMergeRequestsScope)}>
            <option value="created_by_me">Created by me</option>
            <option value="assigned_to_me">Assigned to me</option>
          </select>
          <select className="input" style={{ width: 130 }} value={state} onChange={(event) => setState(event.target.value as TMyMergeRequestsState)}>
            <option value="all">All states</option>
            <option value="opened">Open</option>
            <option value="merged">Merged</option>
            <option value="closed">Closed</option>
          </select>
          <select className="input" style={{ width: 120 }} value={perPage} onChange={(event) => setPerPage(Number(event.target.value))}>
            <option value={10}>10 / page</option>
            <option value={20}>20 / page</option>
            <option value={50}>50 / page</option>
          </select>
          <Button variant="sec" size="sm" disabled={loading} onClick={() => void load()}>
            {loading ? <Spinner /> : "Refresh"}
          </Button>
          <label className="row" style={{ gap: 4, alignItems: "center" }}>
            <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
            <span className="note">Auto-refresh while a build is running</span>
          </label>
          <span className="note" style={{ marginLeft: "auto" }}>
            {loadedAt ? `updated ${loadedAt.toLocaleTimeString()}` : ""}
            {anyRunning && autoRefresh ? " · refreshing every 15s" : ""}
          </span>
        </div>

        {items && (
          <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            {BUILD_FILTERS.map(([key, label, badgeClass]) => (
              <button
                key={key}
                type="button"
                className={`status-badge ${badgeClass}`}
                style={{ cursor: "pointer", border: buildFilter === key ? "1px solid currentColor" : "1px solid transparent" }}
                onClick={() => setBuildFilter(key)}
              >
                {label} · {counts[key]}
              </button>
            ))}
            <span className="note">on this page</span>
            {visible.length > 0 && (
              <span style={{ marginLeft: "auto" }}>
                <CopyButton text={shareReport(visible)} label={`Copy report (${visible.length})`} title="Copy every MR shown below as a one-line-per-MR list, ready to paste into chat" />
              </span>
            )}
          </div>
        )}

        {search && (
          <div className="note" style={{ marginTop: 8 }}>
            Searching for “{search}” ·{" "}
            <a href="#my-merge-requests" onClick={(event) => { event.preventDefault(); setSearch(""); setSearchDraft(""); }}>clear</a>
          </div>
        )}

        {error && <div className="errbox" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {items && !visible.length && !loading && <EmptyState>No merge requests match these filters.</EmptyState>}

      {visible.length > 0 && (
        <div className="ts-card" style={{ marginTop: 12 }}>
          <div style={{ overflow: "auto" }}>
            <table className="grid">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Merge request</th>
                  <th style={{ textAlign: "left" }}>Project</th>
                  <th style={{ textAlign: "left" }}>Merge flow</th>
                  <th style={{ textAlign: "left" }}>State</th>
                  <th style={{ textAlign: "left" }}>Build</th>
                  <th style={{ textAlign: "left" }}>When</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((mr) => (
                  <tr key={`${mr.projectId}!${mr.iid}`} style={{ verticalAlign: "top" }}>
                    <td style={{ maxWidth: 360 }}>
                      <a href={mr.webUrl} target="_blank" rel="noreferrer">{mr.title}</a>
                      <div className="row" style={{ gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                        <span className="ts-step-detail">!{mr.iid}{mr.author ? ` · by ${mr.author}` : ""}</span>
                        {mr.draft && <span className="status-badge browser-auth">Draft</span>}
                        {mr.ticketKeys.map((key) => (
                          <span key={key} className="status-badge starting">{key}</span>
                        ))}
                        {mr.labels.map((labelName) => (
                          <span key={labelName} className="status-badge stopped">{labelName}</span>
                        ))}
                      </div>
                      <div className="row" style={{ gap: 2, marginTop: 4 }}>
                        <CopyButton text={mr.webUrl} label="Copy link" title="Copy the MR's GitLab URL" />
                        <CopyButton text={shareSummary(mr)} label="Copy summary" title="Copy ticket, project, branches, build status and all links as a chat-ready message" />
                      </div>
                    </td>
                    <td style={{ maxWidth: 280 }}>
                      <span className="status-badge stopped" title="Top-level GitLab group (customer)">{mr.customer}</span>
                      <div style={{ marginTop: 2 }}>
                        <a href={mr.projectWebUrl} target="_blank" rel="noreferrer" title={mr.pathWithNamespace}><b>{mr.projectName}</b></a>
                      </div>
                      {mr.groupPath && <div className="ts-step-detail">{mr.groupPath}</div>}
                    </td>
                    <td className="ts-step-detail">
                      <div style={{ whiteSpace: "nowrap" }}>
                        <a href={branchUrl(mr, mr.sourceBranch)} target="_blank" rel="noreferrer"><code>{mr.sourceBranch}</code></a>
                        {" → "}
                        <a href={branchUrl(mr, mr.targetBranch)} target="_blank" rel="noreferrer"><code>{mr.targetBranch}</code></a>
                      </div>
                      {mr.mergedBy && <div>merged by {mr.mergedBy}</div>}
                      {mr.commitSha && mr.commitUrl && (
                        <div>
                          {mr.state === "merged" ? "merge commit" : "head"}{" "}
                          <a href={mr.commitUrl} target="_blank" rel="noreferrer"><code>{mr.commitSha.slice(0, 8)}</code></a>
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${MR_STATE_CLASS[mr.state] ?? "stopped"}`}>{mr.state}</span>
                    </td>
                    <td>
                      {mr.pipeline ? (
                        <>
                          <PipelineBadge pipeline={mr.pipeline} />
                          <div className="ts-step-detail">
                            {mr.pipeline.sha && <>for <code>{mr.pipeline.sha.slice(0, 8)}</code> </>}on {mr.pipelineRef}
                            {pipelineTiming(mr.pipeline) && <> · {pipelineTiming(mr.pipeline)}</>}
                          </div>
                          {mr.externalJobs.map((job) => (
                            <div key={job.targetUrl} className="ts-step-detail">
                              <a href={job.targetUrl} target="_blank" rel="noreferrer" title="Open build in Jenkins">{job.name} · {job.status} ↗</a>
                            </div>
                          ))}
                          <div className="row" style={{ gap: 2, marginTop: 4 }}>
                            <CopyButton text={mr.pipeline.webUrl} label="Copy pipeline" title="Copy the GitLab pipeline URL" />
                            {mr.externalJobs[0] && <CopyButton text={mr.externalJobs[0].targetUrl} label="Copy Jenkins" title="Copy the Jenkins build URL" />}
                          </div>
                        </>
                      ) : (
                        <span className="note">{mr.state === "closed" ? "—" : "no pipeline"}</span>
                      )}
                    </td>
                    <td className="note" style={{ whiteSpace: "nowrap" }}>
                      {mr.mergedAt ? (
                        <div title={new Date(mr.mergedAt).toLocaleString()}>merged {relativeTime(mr.mergedAt)}</div>
                      ) : (
                        <div title={new Date(mr.updatedAt).toLocaleString()}>updated {relativeTime(mr.updatedAt)}</div>
                      )}
                      <div className="ts-step-detail" title={new Date(mr.createdAt).toLocaleString()}>created {relativeTime(mr.createdAt)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {items && (page > 1 || hasMore) && (
        <div className="row" style={{ gap: 4, marginTop: 12, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
          <Button variant="sec" size="sm" disabled={loading || page <= 1} onClick={() => setPage(1)}>«</Button>
          <Button variant="sec" size="sm" disabled={loading || page <= 1} onClick={() => setPage(page - 1)}>← Prev</Button>
          {pageNumbers(page, totalPages, hasMore).map((pageNumber) => (
            <Button key={pageNumber} variant={pageNumber === page ? "primary" : "ghost"} size="sm" disabled={loading} onClick={() => setPage(pageNumber)}>
              {pageNumber}
            </Button>
          ))}
          <Button variant="sec" size="sm" disabled={loading || !hasMore} onClick={() => setPage(page + 1)}>Next →</Button>
          {lastPage && <Button variant="sec" size="sm" disabled={loading || page >= lastPage} onClick={() => setPage(lastPage)}>»</Button>}
          <span className="note" style={{ marginLeft: 8 }}>
            Page {page}{lastPage ? ` of ${lastPage}` : ""}{total !== undefined ? ` · ${total} MRs` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
