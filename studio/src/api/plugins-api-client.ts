import type {
  TInstallPlan,
  TInstallScope,
  TPluginCatalogEntry,
  TPluginDoctorReport,
  TPluginManifest,
  TPluginRemoveResult,
  TPluginUpdateResult,
  TStudioExtension,
  TStudioExtensionFileEntry,
  TStudioExtensionInstance,
} from "./plugins-api-types";

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

export const pluginsApi = {
  list: (projectRoot?: string) => get<{ plugins: TPluginCatalogEntry[] }>(`/api/plugins${qs({ projectRoot })}`),

  getDetail: (id: string) => get<{ manifest: TPluginManifest; usage: string | null }>(`/api/plugins/registry/${encodeURIComponent(id)}`),

  buildPlan: (ids: string[], scope: TInstallScope, projectRoot?: string) => post<{ plan: TInstallPlan }>("/api/plugins/plan", { ids, scope, projectRoot }),

  install: (ids: string[], scope: TInstallScope, projectRoot?: string, force?: boolean) =>
    post<{ plan: TInstallPlan }>("/api/plugins/install", { ids, scope, projectRoot, force }),

  remove: (id: string, projectRoot?: string, forceCascade?: boolean) =>
    post<TPluginRemoveResult>(`/api/plugins/${encodeURIComponent(id)}/remove`, { projectRoot, forceCascade }),

  update: (id: string, projectRoot?: string, force?: boolean) =>
    post<TPluginUpdateResult>(`/api/plugins/${encodeURIComponent(id)}/update`, { projectRoot, force }),

  doctor: (projectRoot?: string) => get<TPluginDoctorReport>(`/api/plugins/doctor${qs({ projectRoot })}`),

  listStudioExtensionInstances: (id: string, projectRoot: string) =>
    get<{ extension: TStudioExtension; instances: TStudioExtensionInstance[] }>(`/api/plugins/${encodeURIComponent(id)}/studio-extension/instances${qs({ projectRoot })}`),

  listStudioExtensionFiles: (id: string, instanceName: string, projectRoot: string) =>
    get<{ instance: TStudioExtensionInstance; files: TStudioExtensionFileEntry[] }>(
      `/api/plugins/${encodeURIComponent(id)}/studio-extension/instances/${encodeURIComponent(instanceName)}/files${qs({ projectRoot })}`,
    ),

  studioExtensionFileUrl: (id: string, instanceName: string, relativePath: string, projectRoot: string) =>
    `/api/plugins/${encodeURIComponent(id)}/studio-extension/instances/${encodeURIComponent(instanceName)}/file${qs({ projectRoot, path: relativePath })}`,
};

export { ApiError };
