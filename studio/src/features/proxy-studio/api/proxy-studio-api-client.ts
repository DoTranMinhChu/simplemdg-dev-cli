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

export type TProxyCaptureMode = "auto" | "http" | "browser";

export type TProxyStatusEvent = {
  envId: string;
  stage: "starting" | "api-attempt" | "playwright-fallback" | "proxy-ready" | "stopped";
  status: "starting" | "authenticating" | "browser-auth" | "ready" | "stopped";
  message: string;
  at: string;
};

export type TProxyEnvironmentSummary = {
  id: string;
  displayName: string;
  repo: string;
  name: string;
  url: string;
  ports: number[];
  captureMode: TProxyCaptureMode;
  userList: Array<{ userID: string }>;
  /** Every configured userID, including ones with no password yet (e.g. after a merge import that didn't carry one). */
  knownUserIds: string[];
  running: boolean;
  runningPorts: number[];
  status: TProxyStatusEvent | null;
};

export type TQuickProxyInfo = {
  id: string;
  port: number;
  url: string;
  createdAt: string;
};

export type TProxyPortInfo = {
  port: number;
  ownerId: string;
  ownerName: string;
  type: "environment" | "quick-proxy";
};

export type TProxyStartResult = {
  message: string;
  envId: string;
  ports: number[];
  capturedAt: string;
  userID: string;
};

export const proxyStudioApi = {
  listEnvironments: () => get<{ configPath: string; environments: TProxyEnvironmentSummary[] }>("/api/proxy/environments"),
  addEnvironment: (input: { repo: string; name: string; url: string }) =>
    post<{ envId?: string; created?: boolean; gitignoreAdded?: string[]; error?: string }>("/api/proxy/environments/add", input),
  updateEnvironment: (input: { envId: string; repo: string; name: string; url: string }) =>
    post<{ envId?: string; idChanged?: boolean; error?: string }>("/api/proxy/environments/update", input),
  deleteEnvironment: (envId: string) => post<{ deleted: boolean }>("/api/proxy/environments/delete", { envId }),
  setEnvironmentPorts: (envId: string, ports: number[]) =>
    post<{ envId?: string; ports?: number[]; error?: string }>("/api/proxy/environments/ports", { envId, ports }),

  saveUser: (input: { envId: string; userID: string; password: string }) =>
    post<{ saved?: boolean; error?: string }>("/api/proxy/users/save", input),
  updateUser: (input: { envId: string; originalUserID: string; userID: string; password?: string }) =>
    post<{ saved?: boolean; error?: string }>("/api/proxy/users/update", input),
  deleteUser: (envId: string, userID: string) => post<{ deleted: boolean }>("/api/proxy/users/delete", { envId, userID }),
  revealUserPassword: (envId: string, userID: string) => post<{ password?: string; error?: string }>("/api/proxy/users/reveal", { envId, userID }),

  startEnvironment: (envId: string, input: { userID?: string; ports?: number[] } = {}) =>
    post<TProxyStartResult & { error?: string }>(`/api/proxy/start/${encodeURIComponent(envId)}`, input),
  openLogin: (envId: string, userID?: string) =>
    post<{ opened?: boolean; error?: string }>("/api/proxy/environments/login", { envId, userID }),
  stopEnvironment: (envId: string, port?: number) =>
    post<{ message: string; envId: string }>(`/api/proxy/stop/${encodeURIComponent(envId)}`, port ? { port } : undefined),
  restartEnvironment: (envId: string, userID?: string) =>
    post<TProxyStartResult & { error?: string }>(`/api/proxy/restart/${encodeURIComponent(envId)}`, userID ? { userID } : undefined),
  getStatus: () =>
    get<{ configPath: string; running: Array<{ envId: string; ports: number[]; info: { capturedAt: string; userID: string } | null; status: TProxyStatusEvent | null }> }>(
      "/api/proxy/status",
    ),
  getLogs: (envId: string) => get<{ envId: string; logs: string[] }>(`/api/proxy/logs/${encodeURIComponent(envId)}`),

  quickAuto: (url: string, port?: number) =>
    post<TQuickProxyInfo & { error?: string }>("/api/proxy/quick/auto", port ? { url, port } : { url }),
  quickPaste: (snippet: string, port?: number) =>
    post<TQuickProxyInfo & { error?: string }>("/api/proxy/quick/paste", port ? { snippet, port } : { snippet }),
  listQuickProxies: () => get<{ quickProxies: TQuickProxyInfo[] }>("/api/proxy/quick/list"),
  stopQuickProxy: (id: string) => post<{ stopped: boolean }>("/api/proxy/quick/stop", { id }),

  listPorts: () => get<{ ports: TProxyPortInfo[] }>("/api/proxy/ports"),
  killPort: (port: number) => post<{ message?: string; ownerId?: string; error?: string }>("/api/proxy/ports/kill", { port }),

  exportUrl: () => "/api/proxy/export",
  importConfig: (config: unknown, overwrite?: boolean) =>
    post<TProxyImportResult & { error?: string }>("/api/proxy/import", { config, overwrite }),
};

export type TProxyImportResult = {
  addedEnvironments: number;
  updatedEnvironments: number;
  addedUsers: number;
  skippedUsers: number;
};
