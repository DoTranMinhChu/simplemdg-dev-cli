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
  const trimmedOllamaUrl = ollamaUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${trimmedOllamaUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
    });
  } catch (error) {
    // The HTTP-error-response case just below already gives a friendly message; a
    // connection-level failure (nobody listening at all, the realistic first-run state since
    // Ollama is a separate install this page defaults to localhost:11434 for) previously threw
    // Node's raw `TypeError: fetch failed` straight through to the UI instead.
    throw new Error(`Could not reach Ollama at ${trimmedOllamaUrl}. Is Ollama running with the '${EMBEDDING_MODEL}' model pulled? (${error instanceof Error ? error.message : String(error)})`);
  }
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
