import { createClient } from "@supabase/supabase-js";

export type TIncidentSearchOptions = {
  supabaseUrl: string;
  supabaseKey: string;
  ollamaUrl: string;
  query: string;
  matchCount?: number;
  matchThreshold?: number;
};

export type TIncidentSearchResult = Record<string, unknown> & { jira_ticket?: string; content?: string; similarity?: number };

const EMBEDDING_MODEL = "qwen3-embedding:0.6b";

async function embedQuery(ollamaUrl: string, text: string): Promise<number[]> {
  const response = await fetch(`${ollamaUrl.replace(/\/+$/, "")}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  });
  const json = (await response.json().catch(() => ({}))) as { embeddings?: number[][]; embedding?: number[] };
  if (!response.ok) throw new Error(`Ollama embedding request failed (HTTP ${response.status}). Is Ollama running with the '${EMBEDDING_MODEL}' model pulled?`);
  const embedding = json.embeddings?.[0] ?? json.embedding;
  if (!Array.isArray(embedding)) throw new Error("Ollama did not return an embedding vector.");
  return embedding;
}

/**
 * Semantic search over a Supabase pgvector table of past incident tickets — NOT a live Jira call
 * (the table is populated out-of-band from real Jira incidents). Query embedding runs through a
 * local Ollama instance, matching the legacy tool's approach. The legacy tool additionally ran the
 * query through hand-rolled NLP keyword extraction before embedding; that's skipped here as a
 * search-quality nicety, not core functionality — raw query text embeds and searches correctly.
 */
export async function searchIncidents(options: TIncidentSearchOptions): Promise<TIncidentSearchResult[]> {
  const embedding = await embedQuery(options.ollamaUrl, options.query);
  const supabase = createClient(options.supabaseUrl, options.supabaseKey);
  const { data, error } = await supabase.rpc("match_documents_v3", {
    query_embedding: embedding,
    match_count: options.matchCount ?? 30,
    match_threshold: options.matchThreshold ?? 0.6,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as TIncidentSearchResult[];
}
