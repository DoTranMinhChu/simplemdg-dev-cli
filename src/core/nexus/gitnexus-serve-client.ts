import { ensureGitNexusServeRunning } from "./gitnexus-serve-launcher";

export type TGitNexusServeCallResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Talks to GitNexus's own persistent local server (`gitnexus serve`) over
 * HTTP instead of spawning a fresh `gitnexus <command>` CLI process — a
 * one-off CLI process pays GitNexus's own native-binding startup cost
 * (LadybugDB + ONNX) on every single call, measured during implementation at
 * 10-15+ seconds regardless of npx/version pinning, while the persistent
 * server answers in well under a second since it already has those bindings
 * loaded. Used only for the hot, latency-sensitive read paths this repo has
 * verified real REST endpoints for (search, repo listing) — everything else
 * (analyze, configure, group/workspace management) stays on the CLI path,
 * where a slower one-off call is an acceptable, infrequent cost.
 */
async function callGitNexusServe<T>(path: string, options?: { method?: "GET" | "POST"; body?: unknown }): Promise<TGitNexusServeCallResult<T>> {
  const server = await ensureGitNexusServeRunning();
  if (!server.ok) return { ok: false, message: server.message };

  try {
    const response = await fetch(`${server.url}${path}`, {
      method: options?.method ?? "GET",
      headers: options?.body !== undefined ? { "content-type": "application/json" } : undefined,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, message: `GitNexus server returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}` };
    }

    return { ok: true, data: (await response.json()) as T };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export type TGitNexusServeSearchMatch = { filePath: string; score: number; rank: number; nodeIds: string[] };
export type TGitNexusServeSearchResponse = { results: TGitNexusServeSearchMatch[]; warning?: string };

/** `POST /api/search` on the persistent server — confirmed by direct testing to respond in ~0.3-0.6s vs. 10-15s for the equivalent one-off `gitnexus query` CLI spawn. Returns file-ranked matches, a different (simpler) shape than the CLI's execution-flow-oriented `query` command. */
export async function serveSearch(repo: string, query: string): Promise<TGitNexusServeCallResult<TGitNexusServeSearchResponse>> {
  return callGitNexusServe<TGitNexusServeSearchResponse>("/api/search", { method: "POST", body: { repo, query } });
}

export type TGitNexusServeRepoEntry = {
  name: string;
  path: string;
  indexedAt: string;
  lastCommit: string;
  stats: { files: number; nodes: number; edges: number; communities: number; processes: number; embeddings: number };
};

/** `GET /api/repos` on the persistent server — confirmed fast (well under a second) vs. the equivalent one-off `gitnexus list` CLI spawn (also several seconds, same native-binding startup cost as every other CLI invocation). Backs `listAnalyzedRepos()`, which every Nexus route resolves a repo through — the single highest-leverage place to avoid a CLI spawn. */
export async function serveListRepos(): Promise<TGitNexusServeCallResult<TGitNexusServeRepoEntry[]>> {
  return callGitNexusServe<TGitNexusServeRepoEntry[]>("/api/repos");
}
