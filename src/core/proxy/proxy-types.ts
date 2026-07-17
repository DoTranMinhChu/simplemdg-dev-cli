export type TProxyLoginSelectors = {
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
  postLoginWaitMs?: number;
  errorMessageSelectors?: string;
  loginFormSelector?: string;
};

export type TProxyCaptureConfig = {
  requestUrlPattern?: string;
  triggerSelector?: string;
  allowHeaders?: string[];
  acceptLanguage?: string;
  sapLanguage?: string;
};

/** auto: HTTP form login first, fall back to a headless browser on failure. */
export type TProxyCaptureMode = "auto" | "http" | "browser";

export type TProxyUserCredential = {
  userID: string;
  /** Stored raw. */
  password: string;
};

/** One environment entry as stored locally in `~/.simplemdg/proxy/environments.json`. */
export type TProxyEnvironmentDefinition = {
  repo: string;
  name: string;
  url: string;
  userList: TProxyUserCredential[];
  /** Custom port pair/list for this environment, so it never collides with another env's ports. */
  ports?: number[];
  captureMode?: TProxyCaptureMode;
  login?: TProxyLoginSelectors;
  capture?: TProxyCaptureConfig;
};

export type TProxyConfigDefaults = {
  login?: TProxyLoginSelectors;
  capture?: TProxyCaptureConfig;
  captureMode?: TProxyCaptureMode;
};

export type TProxyConfigFile = {
  defaults?: TProxyConfigDefaults;
  environments: TProxyEnvironmentDefinition[];
};

/** An environment definition after merging in `defaults` and sanitizing an id. */
export type TResolvedProxyEnvironment = {
  id: string;
  displayName: string;
  repo: string;
  name: string;
  url: string;
  /** Usable credentials only (non-empty, decrypted password) — see `knownUserIds` for the full configured list. */
  userList: TProxyUserCredential[];
  /** Every userID configured for this environment, including ones with no password yet (e.g. after
   * a merge import that didn't carry one) — lets the CLI/Studio surface "needs a password" instead
   * of silently hiding them the way `userList` (usable credentials only) would. */
  knownUserIds: string[];
  ports: number[];
  captureMode: TProxyCaptureMode;
  login: TProxyLoginSelectors;
  capture: TProxyCaptureConfig;
};

export type TCapturedSession = {
  headers: Record<string, string>;
  method?: string;
  url?: string;
  body?: string;
  capturedAt: string;
};

export type TProxyRuntimeStatus = "starting" | "authenticating" | "browser-auth" | "ready" | "stopped";

export type TProxyStatusEventStage = "starting" | "api-attempt" | "playwright-fallback" | "proxy-ready" | "stopped";

export type TProxyStatusEvent = {
  envId: string;
  stage: TProxyStatusEventStage;
  status: TProxyRuntimeStatus;
  message: string;
  at: string;
};

export type TProxyLogEvent = {
  envId: string;
  line: string;
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
