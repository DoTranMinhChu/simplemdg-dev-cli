import type {
  TAiActionResult,
  TAiDoctorReport,
  TAiExportPreview,
  TAiObservation,
  TAiOverview,
  TAiSession,
  TAiSessionExportInput,
  TAiSessionLaunchResponse,
  TAiTurn,
  TIngestionResult,
  TSessionAdvisor,
  TSessionAnalysis,
  TSessionListResponse,
  TShellKind,
} from "./ai-studio-api-types";

class ApiError extends Error {}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "content-type": "application/json", ...init.headers } : init?.headers,
  });

  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text };
  }

  if (!response.ok) {
    const message = (json as { error?: string })?.error ?? `HTTP ${response.status}`;
    throw new ApiError(message);
  }

  return json as T;
}

function get<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET" });
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body !== undefined ? JSON.stringify(body) : undefined });
}

/** Like `post`, but for endpoints that return a downloadable file rather than JSON (export). */
async function postForBlob(path: string, body: unknown): Promise<{ blob: Blob; fileName: string | undefined }> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  if (!response.ok) {
    const text = await response.text();
    let message = `HTTP ${response.status}`;
    try {
      message = (JSON.parse(text) as { error?: string })?.error ?? message;
    } catch {
      // Non-JSON error body; keep the generic message.
    }
    throw new ApiError(message);
  }

  const fileName = response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1];
  return { blob: await response.blob(), fileName };
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export type TSessionFilter = { provider?: string; project?: string; cwd?: string; search?: string; hasErrors?: boolean; pinnedOnly?: boolean };
export type TProjectOption = { project: string; cwd: string; sessionCount: number };

export const aiStudioApi = {
  getOverview: () => get<TAiOverview>("/api/ai/overview"),
  getProjects: () => get<{ projects: TProjectOption[] }>("/api/ai/projects"),
  getDoctor: () => get<TAiDoctorReport>("/api/ai/doctor"),
  refresh: () => post<TIngestionResult>("/api/ai/refresh"),

  listSessions: (filter: TSessionFilter, cursor: string | undefined, limit = 50) =>
    get<TSessionListResponse>(`/api/ai/sessions${qs({ ...filter, cursor, limit })}`),

  getSession: (sessionId: string) => get<{ session: TAiSession }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}`),

  getTurns: (sessionId: string, reveal = false) => get<{ turns: TAiTurn[] }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/turns${qs({ reveal })}`),

  getObservations: (sessionId: string, options?: { turnIndex?: number; reveal?: boolean }) =>
    get<{ observations: TAiObservation[] }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/observations${qs({ turnIndex: options?.turnIndex, reveal: options?.reveal })}`),

  getAnalysis: (sessionId: string) => get<TSessionAnalysis>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/analysis`),

  getAdvisor: (sessionId: string) => get<TSessionAdvisor>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/advisor`),

  setScore: (sessionId: string, value: "good" | "bad") => post<{ ok: boolean }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/score`, { value }),

  exportUrl: (sessionId: string) => `/api/ai/sessions/${encodeURIComponent(sessionId)}/export`,

  setPinned: (sessionId: string, value: boolean) => post<{ ok: boolean }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/pin`, { value }),

  setFavorite: (sessionId: string, value: boolean) => post<{ ok: boolean }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/favorite`, { value }),

  getLaunch: (sessionId: string, shell?: TShellKind) =>
    get<TAiSessionLaunchResponse>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/launch${qs({ shell })}`),

  openTerminal: (sessionId: string, mode: "resume" | "continue" = "resume") =>
    post<TAiActionResult>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/open-terminal`, { mode }),

  openProject: (sessionId: string) => post<TAiActionResult>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/open-project`),

  openVsCode: (sessionId: string) => post<TAiActionResult>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/open-vscode`),

  /** Opens a file-reference link from rendered chat markdown in VS Code, resolved against the session's cwd. */
  openFile: (sessionId: string, path: string, line?: number) =>
    post<TAiActionResult>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/open-file`, { path, line }),

  getContinuationPrompt: (sessionId: string) =>
    get<{ prompt: string }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/continuation-prompt`),

  previewExport: (sessionId: string, input: TAiSessionExportInput) =>
    post<TAiExportPreview>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/export/preview`, input),

  runExport: (sessionId: string, input: TAiSessionExportInput) => postForBlob(`/api/ai/sessions/${encodeURIComponent(sessionId)}/export`, input),
};

export { ApiError };
export type { TAiObservation };
