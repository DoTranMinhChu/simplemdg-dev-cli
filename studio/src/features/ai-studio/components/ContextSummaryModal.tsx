import { useEffect, useState } from "react";
import { Modal } from "../../../components/common/Modal";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { Markdown } from "../../../components/common/Markdown";
import { aiStudioApi } from "../../../api/ai-studio-api-client";

/**
 * On-demand "what does the AI currently understand about this session" — makes a real (small) API
 * call each time it's opened/regenerated, asking the model to summarize a reconstructed transcript
 * of its own current live context (see summarizeCurrentContext in ai-context-summary.ts). Never
 * runs automatically; only when the user explicitly opens this from the Conversation toolbar.
 */
export function ContextSummaryModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }): React.ReactElement {
  const [state, setState] = useState<{ loading: boolean; summary?: string; error?: string }>({ loading: true });
  const [copied, setCopied] = useState(false);
  const [runId, setRunId] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });
    aiStudioApi
      .summarizeContext(sessionId)
      .then((result) => {
        if (cancelled) return;
        setState(result.ok ? { loading: false, summary: result.summary } : { loading: false, error: result.error });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, runId]);

  const copy = (): void => {
    if (!state.summary) return;
    navigator.clipboard.writeText(state.summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <Modal onClose={onClose} width={620}>
      <h3>What the AI currently understands</h3>
      <p className="note" style={{ marginBottom: 10 }}>
        A fresh, one-off model call summarizing everything since the last context compaction (or the whole session, if it was never compacted). This is not read from cache — each
        run costs a small real API call.
      </p>

      {state.loading ? (
        <div className="row" style={{ gap: 8, padding: "16px 0" }}>
          <Spinner /> Asking the model to summarize its current context…
        </div>
      ) : state.error ? (
        <div className="errbox">{state.error}</div>
      ) : (
        <div className="cell-pre wrap" style={{ maxHeight: 420, overflowY: "auto" }}>
          <Markdown text={state.summary ?? ""} />
        </div>
      )}

      <div className="row right" style={{ marginTop: 14, gap: 8 }}>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        {!state.loading ? (
          <Button variant="ghost" onClick={() => setRunId((prev) => prev + 1)}>
            Regenerate
          </Button>
        ) : null}
        {state.summary ? <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button> : null}
      </div>
    </Modal>
  );
}
