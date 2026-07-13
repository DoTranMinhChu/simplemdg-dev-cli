import type { TAiDoctorReport, TAiObservation, TAiOverview, TAiSession, TAiTurn, TIngestionResult, TSessionAnalysis, TSessionListResponse } from "./ai-studio-api-types";

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

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export type TSessionFilter = { provider?: string; project?: string; search?: string; hasErrors?: boolean };

export const aiStudioApi = {
  getOverview: () => get<TAiOverview>("/api/ai/overview"),
  getProjects: () => get<{ projects: Array<{ project: string; sessionCount: number }> }>("/api/ai/projects"),
  getDoctor: () => get<TAiDoctorReport>("/api/ai/doctor"),
  refresh: () => post<TIngestionResult>("/api/ai/refresh"),

  listSessions: (filter: TSessionFilter, cursor: string | undefined, limit = 50) =>
    get<TSessionListResponse>(`/api/ai/sessions${qs({ ...filter, cursor, limit })}`),

  getSession: (sessionId: string) => get<{ session: TAiSession }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}`),

  getTurns: (sessionId: string, reveal = false) => get<{ turns: TAiTurn[] }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/turns${qs({ reveal })}`),

  getObservations: (sessionId: string, options?: { turnIndex?: number; reveal?: boolean }) =>
    get<{ observations: TAiObservation[] }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/observations${qs({ turnIndex: options?.turnIndex, reveal: options?.reveal })}`),

  getAnalysis: (sessionId: string) => get<TSessionAnalysis>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/analysis`),

  setScore: (sessionId: string, value: "good" | "bad") => post<{ ok: boolean }>(`/api/ai/sessions/${encodeURIComponent(sessionId)}/score`, { value }),

  exportUrl: (sessionId: string) => `/api/ai/sessions/${encodeURIComponent(sessionId)}/export`,
};

export { ApiError };
export type { TAiObservation };
