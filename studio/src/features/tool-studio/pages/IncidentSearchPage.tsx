import { useState } from "react";
import { Button } from "../../../components/common/Button";
import { Spinner } from "../../../components/common/Spinner";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAsync } from "../../../hooks/useAsync";
import { toolStudioApi } from "../api/tool-studio-api-client";

export function IncidentSearchPage(): React.ReactElement {
  const [supabaseUrl, setSupabaseUrl] = useState("");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [query, setQuery] = useState("");

  const search = useAsync(() => toolStudioApi.searchIncidents({ supabaseUrl, supabaseKey, ollamaUrl, query }));

  return (
    <div>
      <div className="ts-header">
        <h1>Incident Search</h1>
        <p className="note">
          Semantic search over a Supabase pgvector table of past incident tickets — not a live Jira call. Query
          embedding runs through a local Ollama instance.
        </p>
      </div>

      <div className="ts-card">
        <div className="ts-grid-2">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Supabase URL</label>
            <input className="input" value={supabaseUrl} onChange={(event) => setSupabaseUrl(event.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Supabase key</label>
            <input className="input" type="password" value={supabaseKey} onChange={(event) => setSupabaseKey(event.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Ollama URL</label>
            <input className="input" value={ollamaUrl} onChange={(event) => setOllamaUrl(event.target.value)} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label>Query</label>
            <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Describe the problem..." />
          </div>
        </div>

        <div className="row">
          <Button onClick={() => void search.run()} disabled={search.loading || !query || !supabaseUrl || !supabaseKey}>
            {search.loading ? <Spinner /> : "Search"}
          </Button>
        </div>

        {search.error && <div className="errbox" style={{ marginTop: 12 }}>{search.error}</div>}
        {search.data?.error && <div className="errbox" style={{ marginTop: 12 }}>{search.data.error}</div>}

        {search.data?.results && (
          search.data.results.length ? (
            <div className="wiz-body" style={{ marginTop: 12 }}>
              {search.data.results.map((result, index) => (
                <div className="trow" key={index}>
                  <div className="trow-main">
                    <div className="trow-title">{result.jira_ticket ?? `Result ${index + 1}`}</div>
                    <div className="trow-meta">{typeof result.content === "string" ? result.content.slice(0, 160) : ""}</div>
                  </div>
                  {typeof result.similarity === "number" && <div className="note">{(result.similarity * 100).toFixed(0)}%</div>}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState>No matching incidents found.</EmptyState>
          )
        )}
      </div>
    </div>
  );
}
