import { runCommand } from "../process";
import { readCache, rememberCloudFoundryLoginProfile, clearCloudFoundryLoginProfiles } from "../cache";
import { inferCloudFoundryRegionFromApiEndpoint, readCloudFoundryTarget } from "../cf";
import { decryptSecret, encryptSecret } from "../db/db-crypto";
import type { TCloudFoundryLoginProfile } from "../types";

export type TCfAuthStatus = {
  cfCliAvailable: boolean;
  hasCachedCredentials: boolean;
  isLoggedIn: boolean;
  cachedUsername?: string;
  lastLoginAt?: string;
  currentTarget?: {
    region?: string;
    apiEndpoint?: string;
    org?: string;
    space?: string;
  };
  authMode: "cached-password" | "none";
  message?: string;
};

export type TCfLoginInput = {
  apiEndpoint: string;
  region?: string;
  username: string;
  password: string;
  remember: boolean;
};

export type TCfLoginResult = {
  success: boolean;
  username?: string;
  apiEndpoint?: string;
  region?: string;
  message?: string;
  error?: string;
};

async function isCfCliAvailable(): Promise<boolean> {
  const result = await runCommand("cf", ["--version"]).catch(() => undefined);
  return Boolean(result && result.exitCode === 0);
}

/**
 * Decrypt a CF profile password that may be either plain-text (legacy) or
 * `enc:…` encrypted by cf-auth-service. Call this before passing a cached
 * password to `cf auth`.
 */
export function decryptCfPassword(stored: string): string {
  return decryptSecret(stored);
}

/** Redact a password out of raw CF CLI output before it's ever logged or returned. */
function redactPassword(raw: string, password: string): string {
  if (!password) return raw.trim();
  return raw.replace(new RegExp(password.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "***").trim();
}

/**
 * Studio (and background scans) authenticate against an isolated CF_HOME per
 * region, separate from the developer's default/global `cf` session. The
 * global session can be logged out while an isolated region session (set up by
 * a previous Studio login) is still perfectly valid — so treat either as
 * "logged in". Only probes ONE region (the most recently used cached profile)
 * to keep this endpoint fast; it never triggers a re-login itself.
 */
async function hasUsableIsolatedCfSession(profile: TCloudFoundryLoginProfile): Promise<boolean> {
  const { cfExecutionService, getCfHomeForRegion } = await import("./cf-execution-service");
  const region = inferCloudFoundryRegionFromApiEndpoint(profile.apiEndpoint);
  const context = { region, apiEndpoint: profile.apiEndpoint, cfHome: getCfHomeForRegion(region) };
  const result = await cfExecutionService.runCf(context, ["orgs"], { silent: true });
  return result.exitCode === 0;
}

export async function getCfAuthStatus(): Promise<TCfAuthStatus> {
  const cfCliAvailable = await isCfCliAvailable();

  if (!cfCliAvailable) {
    return {
      cfCliAvailable: false,
      hasCachedCredentials: false,
      isLoggedIn: false,
      authMode: "none",
      message: "CF CLI (cf) is not installed or not on PATH.",
    };
  }

  const cache = await readCache();
  const profilesWithPassword = cache.cloudFoundry.loginProfiles.filter((p) => p.password?.trim());
  const mostRecent = profilesWithPassword[0] ?? cache.cloudFoundry.loginProfiles[0];

  // Fast path: the developer's default/global CF session.
  const orgsCheck = await runCommand("cf", ["orgs"]);
  let isLoggedIn = orgsCheck.exitCode === 0;
  let currentTarget: TCfAuthStatus["currentTarget"];

  if (isLoggedIn) {
    const target = await readCloudFoundryTarget();
    currentTarget = {
      apiEndpoint: target.apiEndpoint,
      org: target.org,
      space: target.space,
      region: target.apiEndpoint ? inferCloudFoundryRegionFromApiEndpoint(target.apiEndpoint) : undefined,
    };
  } else if (mostRecent?.password?.trim()) {
    // Global session is logged out — check whether the isolated CF_HOME Studio
    // uses for the most-recently-used region already has a valid session
    // (e.g. from a prior Studio login) before reporting "not connected".
    const isolatedOk = await hasUsableIsolatedCfSession(mostRecent).catch(() => false);
    if (isolatedOk) {
      isLoggedIn = true;
      currentTarget = { apiEndpoint: mostRecent.apiEndpoint, region: inferCloudFoundryRegionFromApiEndpoint(mostRecent.apiEndpoint) };
    }
  }

  return {
    cfCliAvailable: true,
    hasCachedCredentials: profilesWithPassword.length > 0,
    isLoggedIn,
    cachedUsername: mostRecent?.username,
    lastLoginAt: mostRecent?.updatedAt,
    authMode: profilesWithPassword.length > 0 ? "cached-password" : "none",
    currentTarget,
    message: !isLoggedIn && profilesWithPassword.length > 0
      ? "Cached credentials found. Studio will automatically re-login when needed."
      : undefined,
  };
}

export async function loginCfWithPassword(input: TCfLoginInput): Promise<TCfLoginResult> {
  const cfCliAvailable = await isCfCliAvailable();
  if (!cfCliAvailable) {
    return { success: false, error: "CF CLI (cf) is not installed or not on PATH. Install it and restart Studio." };
  }

  const apiResult = await runCommand("cf", ["api", input.apiEndpoint]);
  if (apiResult.exitCode !== 0) {
    const detail = (apiResult.stderr || apiResult.stdout || "").trim();
    return { success: false, error: `Cannot connect to ${input.apiEndpoint}.${detail ? " " + detail : ""}` };
  }

  // Never log the password — pass it directly to cf auth only.
  const authResult = await runCommand("cf", ["auth", input.username, input.password]);
  if (authResult.exitCode !== 0) {
    const raw = authResult.stderr || authResult.stdout || "";
    const safeDetail = redactPassword(raw, input.password);
    return { success: false, error: `Login failed. ${safeDetail || "Invalid username or password."}` };
  }

  const region = input.region || inferCloudFoundryRegionFromApiEndpoint(input.apiEndpoint);

  // Also authenticate the isolated per-region CF_HOME that Studio and
  // background scans use, so it's immediately usable without waiting for a
  // second re-login round trip. Best-effort: a failure here doesn't fail the
  // overall login — CfExecutionService.ensureCfLoggedIn will retry with the
  // same cached credentials the next time the isolated session is needed.
  const { cfExecutionService } = await import("./cf-execution-service");
  await cfExecutionService
    .runInRegionWithoutAutoLogin(region, input.apiEndpoint, async (context) => {
      await cfExecutionService.runCf(context, ["auth", input.username, input.password], { silent: true });
    })
    .catch(() => undefined);

  if (input.remember) {
    const profile: TCloudFoundryLoginProfile = {
      apiEndpoint: input.apiEndpoint,
      org: "",
      username: input.username,
      // Encrypt the password before persisting — never store plain text.
      password: encryptSecret(input.password),
      updatedAt: new Date().toISOString(),
    };
    await rememberCloudFoundryLoginProfile(profile);
  }

  return {
    success: true,
    username: input.username,
    apiEndpoint: input.apiEndpoint,
    region,
    message: `Logged in as ${input.username} to ${region}.`,
  };
}

/**
 * Log out of the developer's default/global CF session. Optionally also
 * forget all cached SimpleMDG login profiles (isolated per-region CF_HOME
 * sessions are left in place — they simply stop being auto-refreshed once
 * their cached credential is gone).
 */
export async function cfLogout(options?: { clearCachedCredentials?: boolean }): Promise<{ ok: boolean }> {
  await runCommand("cf", ["logout"]).catch(() => undefined);
  if (options?.clearCachedCredentials) {
    await clearCloudFoundryLoginProfiles();
  }
  return { ok: true };
}
