import type {
  TCapturedSession,
  TProxyStatusEventStage,
  TProxyUserCredential,
  TResolvedProxyEnvironment,
} from "./proxy-types";
import { captureHeadersWithHttpRequests } from "./proxy-auth-http";
import { captureHeadersWithPlaywright } from "./proxy-auth-browser";
import { describeAuthError, formatCapturedSessionForLog } from "./proxy-auth-shared";

export type TProxyCaptureCallbacks = {
  onLog?: (message: string) => void;
  onStage?: (stage: TProxyStatusEventStage, message: string) => void;
};

/**
 * Mode selection: `auto` tries the fast HTTP form login first and only falls back to a
 * headless Playwright browser on failure (JS-rendered/SSO login pages can't be driven by
 * plain HTTP). `http`/`browser` force one strategy, for environments where the outcome is
 * already known and re-discovering the HTTP failure every time would just waste time.
 */
export async function captureProxySession(
  env: TResolvedProxyEnvironment,
  selectedUser: TProxyUserCredential,
  callbacks: TProxyCaptureCallbacks = {},
): Promise<TCapturedSession> {
  const onLog = callbacks.onLog ?? ((): void => undefined);
  const onStage = callbacks.onStage ?? ((): void => undefined);
  const log = (strategy: "HTTP" | "PLAYWRIGHT", message: string): void => onLog(`[${env.displayName}][STRATEGY: ${strategy}] ${message}`);

  // Single funnel point for every capture (initial or refresh, any strategy) — logging the
  // outcome here once means "did we get a session, and what's in it" is always answerable
  // from the log, without having to reason about which strategy/branch handled this call.
  const logCaptured = (strategy: "HTTP" | "PLAYWRIGHT", session: TCapturedSession): void => {
    log(strategy, "Success: headers retrieved.");
    log(strategy, `SESSION CAPTURED for ${selectedUser.userID}:\n${formatCapturedSessionForLog(session)}`);
  };
  const logCaptureFailed = (reason: string): void => {
    onLog(`[${env.displayName}] SESSION CAPTURE FAILED for ${selectedUser.userID}: ${reason}`);
  };

  if (env.captureMode === "browser") {
    onStage("playwright-fallback", "Browser authentication in progress.");
    log("PLAYWRIGHT", `Falling back to browser for ${env.displayName} (${env.url}) as ${selectedUser.userID}.`);
    const session = await captureHeadersWithPlaywright(env, selectedUser, (message) => log("PLAYWRIGHT", message));
    logCaptured("PLAYWRIGHT", session);
    return session;
  }

  if (env.captureMode === "http") {
    onStage("api-attempt", "HTTP authentication in progress.");
    try {
      const session = await captureHeadersWithHttpRequests(env, selectedUser, (message) => log("HTTP", message));
      logCaptured("HTTP", session);
      return session;
    } catch (error) {
      const message = describeAuthError(error);
      log("HTTP", `Login failed: ${message}`);
      logCaptureFailed(message);
      throw error;
    }
  }

  // auto: HTTP first, browser fallback.
  try {
    onStage("api-attempt", "HTTP authentication in progress.");
    const session = await captureHeadersWithHttpRequests(env, selectedUser, (message) => log("HTTP", message));
    logCaptured("HTTP", session);
    return session;
  } catch (httpFailure) {
    const httpError = describeAuthError(httpFailure);
    log("HTTP", `Login failed. Falling back to browser authentication. ${httpError}`);

    try {
      onStage("playwright-fallback", "Browser authentication in progress.");
      log("PLAYWRIGHT", `Falling back to browser for ${env.displayName} (${env.url}) as ${selectedUser.userID}.`);
      const session = await captureHeadersWithPlaywright(env, selectedUser, (message) => log("PLAYWRIGHT", message));
      logCaptured("PLAYWRIGHT", session);
      return session;
    } catch (browserFailure) {
      const browserError = describeAuthError(browserFailure);
      log("PLAYWRIGHT", `Fallback failed: ${browserError}`);
      logCaptureFailed(`HTTP: ${httpError}. Playwright: ${browserError}`);
      throw new Error(`Authentication failed. HTTP: ${httpError}. Playwright: ${browserError}`);
    }
  }
}
