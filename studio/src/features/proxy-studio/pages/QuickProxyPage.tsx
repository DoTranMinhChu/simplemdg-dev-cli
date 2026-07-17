import { useEffect, useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { useAsync } from "../../../hooks/useAsync";
import { proxyStudioApi } from "../api/proxy-studio-api-client";
import { LogPanel } from "../components/LogPanel";

export function QuickProxyPage(): React.ReactElement {
  const quickList = useAsync(() => proxyStudioApi.listQuickProxies());
  useEffect(() => {
    void quickList.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="ts-header">
        <h1>Quick Proxy</h1>
        <p className="note">
          No stored credential, never saved to your environments — for a one-off test session. It will NOT auto-refresh;
          re-capture once it expires.
        </p>
      </div>

      <AutoCapturePanel onStarted={() => void quickList.run()} />
      <PasteSnippetPanel onStarted={() => void quickList.run()} />

      <div className="ts-card" style={{ marginTop: 12 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Running quick proxies</strong>
          <Button variant="ghost" size="sm" onClick={() => void quickList.run()} disabled={quickList.loading}>
            {quickList.loading ? <Spinner /> : "Refresh"}
          </Button>
        </div>

        {(quickList.data?.quickProxies.length ?? 0) === 0 ? (
          <p className="note" style={{ marginTop: 8 }}>None running.</p>
        ) : (
          quickList.data!.quickProxies.map((proxy) => <QuickProxyRow key={proxy.id} id={proxy.id} port={proxy.port} url={proxy.url} onStopped={() => void quickList.run()} />)
        )}
      </div>
    </div>
  );
}

function QuickProxyRow({ id, port, url, onStopped }: { id: string; port: number; url: string; onStopped: () => void }): React.ReactElement {
  const [showLogs, setShowLogs] = useState(false);

  return (
    <div style={{ marginTop: 10, borderTop: "1px solid var(--border, #333)", paddingTop: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span>
          <strong>http://127.0.0.1:{port}</strong> → {url}
        </span>
        <div className="row">
          <Button variant="ghost" size="sm" onClick={() => setShowLogs((value) => !value)}>
            {showLogs ? "Hide logs" : "Show logs"}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={async () => {
              await proxyStudioApi.stopQuickProxy(id);
              onStopped();
            }}
          >
            Stop
          </Button>
        </div>
      </div>
      {showLogs ? (
        <div style={{ marginTop: 8 }}>
          <LogPanel ownerId={id} />
        </div>
      ) : null}
    </div>
  );
}

function AutoCapturePanel({ onStarted }: { onStarted: () => void }): React.ReactElement {
  const [url, setUrl] = useState("");
  const [port, setPort] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ port: number; url: string } | undefined>();

  const doCapture = async (): Promise<void> => {
    if (!url.trim()) {
      setError("A URL is required.");
      return;
    }
    setError("");
    setResult(undefined);
    setCapturing(true);
    try {
      const response = await proxyStudioApi.quickAuto(url.trim(), port.trim() ? Number(port.trim()) : undefined);
      if (response.error) {
        setError(response.error);
        return;
      }
      setResult({ port: response.port, url: response.url });
      onStarted();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : String(captureError));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="ts-card">
      <strong>Auto-capture (recommended)</strong>
      <p className="note">
        Opens a real, visible browser window at this URL. Log in yourself (or reuse an already-authenticated session) — the
        session is captured automatically the moment an authenticated API call is seen. No DevTools needed.
      </p>

      <div className="ts-grid-2">
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label>URL</label>
          <input className="input" placeholder="https://...-simplemdg-web.cfapps...ondemand.com" value={url} onChange={(event) => setUrl(event.target.value)} disabled={capturing} />
        </div>
        <div className="field">
          <label>Port (optional)</label>
          <input className="input" placeholder="auto-picks a free one" value={port} onChange={(event) => setPort(event.target.value)} disabled={capturing} />
        </div>
      </div>

      {capturing ? (
        <div className="note" style={{ marginTop: 8 }}>
          <Spinner /> Waiting for you to log in in the opened browser window...
        </div>
      ) : null}
      {error ? <div className="errbox" style={{ marginTop: 8 }}>{error}</div> : null}
      {result ? (
        <div className="note" style={{ marginTop: 8 }}>
          Ready: http://127.0.0.1:{result.port} → {result.url}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10 }}>
        <Button onClick={() => void doCapture()} disabled={capturing || !url.trim()}>
          {capturing ? "Capturing…" : "Open browser & capture"}
        </Button>
      </div>
    </div>
  );
}

function PasteSnippetPanel({ onStarted }: { onStarted: () => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [snippet, setSnippet] = useState("");
  const [port, setPort] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ port: number; url: string } | undefined>();

  if (!open) {
    return (
      <div className="ts-card" style={{ marginTop: 12 }}>
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Paste a DevTools "Copy as fetch" snippet instead (fallback)
        </Button>
      </div>
    );
  }

  const doStart = async (): Promise<void> => {
    if (!snippet.trim()) {
      setError('Paste a "Copy as fetch" snippet first.');
      return;
    }
    setError("");
    setResult(undefined);
    setStarting(true);
    try {
      const response = await proxyStudioApi.quickPaste(snippet.trim(), port.trim() ? Number(port.trim()) : undefined);
      if (response.error) {
        setError(response.error);
        return;
      }
      setResult({ port: response.port, url: response.url });
      onStarted();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="ts-card" style={{ marginTop: 12 }}>
      <strong>Paste snippet (fallback)</strong>
      <p className="note">In DevTools → Network, right-click the request → Copy → Copy as fetch, then paste it below.</p>

      <div className="field">
        <label>"Copy as fetch" snippet</label>
        <textarea
          className="input"
          rows={8}
          placeholder='fetch("https://...", { "headers": {...}, "body": "...", "method": "POST" });'
          value={snippet}
          onChange={(event) => setSnippet(event.target.value)}
        />
      </div>
      <div className="field">
        <label>Port (optional)</label>
        <input className="input" placeholder="auto-picks a free one" value={port} onChange={(event) => setPort(event.target.value)} />
      </div>

      {error ? <div className="errbox" style={{ marginTop: 8 }}>{error}</div> : null}
      {result ? (
        <div className="note" style={{ marginTop: 8 }}>
          Ready: http://127.0.0.1:{result.port} → {result.url}
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 10 }}>
        <Button onClick={() => void doStart()} disabled={starting || !snippet.trim()}>
          {starting ? "Starting…" : "Start proxy"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
