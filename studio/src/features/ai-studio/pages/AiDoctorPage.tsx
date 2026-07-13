import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { EmptyState } from "../../../components/common/EmptyState";
import { aiStudioApi } from "../../../api/ai-studio-api-client";
import { useAiStudioStore } from "../state/ai-studio-store";
import type { TAiDoctorReport } from "../../../api/ai-studio-api-types";

function severityIcon(severity: string): React.ReactElement {
  if (severity === "error") return <span style={{ color: "var(--red)" }}>✗</span>;
  if (severity === "warning") return <span style={{ color: "var(--amber)" }}>⚠</span>;
  return <span style={{ color: "var(--faint)" }}>i</span>;
}

/** Ingestion status, parser health, and storage location — the browser equivalent of `smdg ai doctor`. */
export function AiDoctorPage(): React.ReactElement {
  const { toast } = useAiStudioStore();
  const [report, setReport] = useState<TAiDoctorReport | undefined>();
  const [refreshing, setRefreshing] = useState(false);

  const load = (): void => {
    aiStudioApi
      .getDoctor()
      .then(setReport)
      .catch((error) => toast(error instanceof Error ? error.message : String(error), "err"));
  };

  useEffect(load, []);

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const result = await aiStudioApi.refresh();
      toast(result.filesIngested > 0 ? `Ingested ${result.filesIngested} new session file(s).` : "No new sessions found.");
      load();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "err");
    } finally {
      setRefreshing(false);
    }
  };

  if (!report) {
    return (
      <div className="ai-page">
        <EmptyState>
          <span className="spin" /> loading...
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="ai-page">
      <div className="ai-page-head">
        <h1>Doctor</h1>
        <div className="lede">Ingestion status, parser health, and storage location.</div>
        <Button size="sm" onClick={onRefresh} disabled={refreshing} style={{ marginTop: 10 }}>
          {refreshing ? "Scanning…" : "⟳ Re-scan"}
        </Button>
      </div>

      <div className="ai-card">
        <h3>Storage</h3>
        <div className="kvs">
          <div className="k">Location</div>
          <div>
            <code>{report.storageDir}</code>
          </div>
          <div className="k">Claude files ingested</div>
          <div>{report.claudeFilesIngested}</div>
          <div className="k">Codex files ingested</div>
          <div>{report.codexFilesIngested}</div>
          <div className="k">Total sessions</div>
          <div>{report.totalSessions}</div>
        </div>
      </div>

      <div className="ai-card">
        <h3>Parser diagnostics ({report.diagnostics.length})</h3>
        {report.diagnostics.length ? (
          <div className="ai-diagnostic-list">
            {report.diagnostics.slice(0, 100).map((diagnostic, index) => (
              <div key={index} className="ai-diagnostic-row">
                <span className="ai-diagnostic-icon">{severityIcon(diagnostic.severity)}</span>
                <div>
                  <div>
                    [{diagnostic.provider}] {diagnostic.message}
                  </div>
                  <div className="note">{diagnostic.sourceFile}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState>No parser diagnostics recorded.</EmptyState>
        )}
      </div>
    </div>
  );
}
