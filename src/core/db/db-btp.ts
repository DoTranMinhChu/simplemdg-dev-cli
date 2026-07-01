import { readCache, rememberCloudFoundryApps } from "../cache";
import {
  buildCloudFoundryTargetKey,
  authenticateCloudFoundry,
  inferCloudFoundryRegionFromApiEndpoint,
  listCloudFoundryApps,
  parseCloudFoundryApps,
  readCloudFoundryTarget,
  setCloudFoundryApiEndpoint,
  targetCloudFoundryOrg,
  targetCloudFoundrySpace,
} from "../cf";
import { runCommand } from "../process";
import { cfExecutionService } from "../cf/cf-execution-service";
import type { TCfExecutionContext } from "../cf/cf-execution-service";
import { decryptCfPassword } from "../cf/cf-auth-service";
import { parseCloudFoundryEnvironment } from "../cf-env-parser";
import { detectDatabaseServiceCandidates } from "./db-vcap-parser";
import { upsertConnectionFromDraft } from "./db-cache";
import type { TConnectionDraft } from "./db-cache";
import type { TDatabaseConnectionProfile, TDatabaseServiceCandidate, TDatabaseType } from "./db-types";
import type { TCloudFoundryApp, TCloudFoundryTarget } from "../types";

export type TCloudFoundrySessionState = {
  loggedIn: boolean;
  target: TCloudFoundryTarget;
  message?: string;
};

async function isCloudFoundryCliAvailable(): Promise<boolean> {
  const result = await runCommand("cf", ["--version"]).catch(() => undefined);
  return Boolean(result && result.exitCode === 0);
}

/**
 * Confirm there is a usable CF session. When the CF CLI reports no session, try
 * to silently re-login using a cached profile that stored its password.
 */
export async function ensureCloudFoundrySession(): Promise<TCloudFoundrySessionState> {
  if (!(await isCloudFoundryCliAvailable())) {
    return {
      loggedIn: false,
      target: {},
      message: "Cloud Foundry CLI 'cf' is not installed or not on PATH. Install it, then run: smdg cf login",
    };
  }

  const orgsCheck = await runCommand("cf", ["orgs"]);

  if (orgsCheck.exitCode === 0) {
    return { loggedIn: true, target: await readCloudFoundryTarget() };
  }

  const cache = await readCache();
  const target = await readCloudFoundryTarget();
  const profilesWithPassword = cache.cloudFoundry.loginProfiles.filter((profile) => profile.password?.trim());

  if (profilesWithPassword.length === 0) {
    return {
      loggedIn: false,
      target,
      message: "Not logged in to Cloud Foundry and no cached password was found. Run: smdg cf login",
    };
  }

  const preferredProfiles = target.apiEndpoint
    ? [
        ...profilesWithPassword.filter((profile) => profile.apiEndpoint === target.apiEndpoint),
        ...profilesWithPassword.filter((profile) => profile.apiEndpoint !== target.apiEndpoint),
      ]
    : profilesWithPassword;

  for (const profile of preferredProfiles) {
    const apiExitCode = await setCloudFoundryApiEndpoint(profile.apiEndpoint);
    if (apiExitCode !== 0) continue;

    const authExitCode = await authenticateCloudFoundry({ username: profile.username, password: decryptCfPassword(profile.password as string) });
    if (authExitCode !== 0) continue;

    await targetCloudFoundryOrg(profile.org).catch(() => undefined);
    if (profile.space) {
      await targetCloudFoundrySpace(profile.space).catch(() => undefined);
    }

    const recheck = await runCommand("cf", ["orgs"]);
    if (recheck.exitCode === 0) {
      return { loggedIn: true, target: await readCloudFoundryTarget() };
    }
  }

  return {
    loggedIn: false,
    target,
    message: "Automatic Cloud Foundry re-login failed. Run: smdg cf login",
  };
}

export async function getCloudFoundryTargetSummary(): Promise<TCloudFoundryTarget & { region?: string }> {
  const target = await readCloudFoundryTarget();
  return {
    ...target,
    region: target.apiEndpoint ? inferCloudFoundryRegionFromApiEndpoint(target.apiEndpoint) : undefined,
  };
}

export async function listCloudFoundryAppsWithCache(options?: { refresh?: boolean }): Promise<TCloudFoundryApp[]> {
  const target = await readCloudFoundryTarget();
  const targetKey = buildCloudFoundryTargetKey(target);

  if (!options?.refresh) {
    const cache = await readCache();
    const cachedEntry = cache.cloudFoundry.appListsByTarget[targetKey];
    if (cachedEntry?.apps.length) {
      return cachedEntry.apps;
    }
  }

  const apps = await listCloudFoundryApps();
  await rememberCloudFoundryApps(targetKey, apps).catch(() => undefined);
  return apps;
}

/**
 * Read and parse VCAP_SERVICES from `cf env <app>`. Never logs the raw output
 * because it contains credentials.
 */
export async function readAppVcapServices(appName: string): Promise<unknown> {
  const result = await runCommand("cf", ["env", appName]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `cf env ${appName} failed`);
  }

  const parsed = parseCloudFoundryEnvironment(result.stdout);

  if (parsed.VCAP_SERVICES === undefined) {
    throw new Error(`VCAP_SERVICES was not found in cf env ${appName}`);
  }

  return parsed.VCAP_SERVICES;
}

export async function detectAppDatabaseServices(appName: string): Promise<TDatabaseServiceCandidate[]> {
  const vcapServices = await readAppVcapServices(appName);
  const candidates = detectDatabaseServiceCandidates(vcapServices);

  if (candidates.length === 0) {
    throw new Error(`No HANA or PostgreSQL service was detected in cf env ${appName}`);
  }

  return candidates;
}

export function buildDraftFromCandidate(
  candidate: TDatabaseServiceCandidate,
  context: { region?: string; org?: string; space?: string; app?: string },
): TConnectionDraft {
  const databaseTypeLabel: Record<TDatabaseType, string> = { hana: "HANA", postgresql: "PostgreSQL" };
  const namePieces = [context.app ?? "btp-app", candidate.serviceName, databaseTypeLabel[candidate.type]].filter(Boolean);

  return {
    name: namePieces.join(" / "),
    type: candidate.type,
    region: context.region,
    org: context.org,
    space: context.space,
    app: context.app,
    serviceName: candidate.serviceName,
    servicePlan: candidate.servicePlan,
    host: candidate.host,
    port: candidate.port,
    database: candidate.database,
    schema: candidate.schema,
    username: candidate.username,
    password: candidate.password,
    ssl: candidate.ssl,
    sslValidateCertificate: candidate.sslValidateCertificate,
  };
}

/**
 * Import a single detected database service from a BTP app into the encrypted
 * connection cache.
 */
export async function importConnectionFromApp(options: {
  app: string;
  serviceName?: string;
  type?: TDatabaseType;
  context?: { region?: string; org?: string; space?: string };
}): Promise<{ profile: TDatabaseConnectionProfile; candidates: TDatabaseServiceCandidate[] }> {
  const candidates = await detectAppDatabaseServices(options.app);
  const target = await readCloudFoundryTarget();

  const chosen = options.serviceName
    ? candidates.find((candidate) => candidate.serviceName === options.serviceName && (!options.type || candidate.type === options.type))
    : candidates[0];

  if (!chosen) {
    throw new Error(`Service '${options.serviceName ?? ""}' was not found among detected database services for ${options.app}`);
  }

  const draft = buildDraftFromCandidate(chosen, {
    region: options.context?.region ?? (target.apiEndpoint ? inferCloudFoundryRegionFromApiEndpoint(target.apiEndpoint) : undefined),
    org: options.context?.org ?? target.org,
    space: options.context?.space ?? target.space,
    app: options.app,
  });

  const profile = await upsertConnectionFromDraft(draft);
  return { profile, candidates };
}

// ---------------------------------------------------------------------------
// Context-aware variants — run CF commands against an isolated CF_HOME via the
// execution service, so Studio multi-target work never touches the developer's
// global `cf target`. Always invoked inside `withCfTarget(...)`.
// ---------------------------------------------------------------------------

/** List apps in the app/space targeted by `context` (isolated CF_HOME). */
export async function listAppsInContext(context: TCfExecutionContext): Promise<TCloudFoundryApp[]> {
  const result = await cfExecutionService.runCf(context, ["apps"], { silent: true });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "cf apps failed");
  }
  return parseCloudFoundryApps(result.stdout);
}

/** Read and parse VCAP_SERVICES from `cf env <app>` under the context. Never logs raw output. */
export async function readAppVcapServicesInContext(context: TCfExecutionContext, appName: string): Promise<unknown> {
  const result = await cfExecutionService.runCf(context, ["env", appName], { silent: true });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || `cf env ${appName} failed`);
  }
  const parsed = parseCloudFoundryEnvironment(result.stdout);
  if (parsed.VCAP_SERVICES === undefined) {
    throw new Error(`VCAP_SERVICES was not found in cf env ${appName}`);
  }
  return parsed.VCAP_SERVICES;
}

/** Detect HANA/PostgreSQL service candidates for an app under the context. */
export async function detectAppDatabaseServicesInContext(
  context: TCfExecutionContext,
  appName: string,
): Promise<TDatabaseServiceCandidate[]> {
  const vcapServices = await readAppVcapServicesInContext(context, appName);
  const candidates = detectDatabaseServiceCandidates(vcapServices);
  if (candidates.length === 0) {
    throw new Error(`No HANA or PostgreSQL service was detected in cf env ${appName}`);
  }
  return candidates;
}

/**
 * Import a database service from a BTP app, reading `cf env` under the supplied
 * context (isolated CF_HOME) and recording the target's region/org/space.
 */
export async function importConnectionFromAppInContext(
  context: TCfExecutionContext,
  options: {
    app: string;
    serviceName?: string;
    type?: TDatabaseType;
    target: { region: string; org: string; space: string };
  },
): Promise<{ profile: TDatabaseConnectionProfile; candidates: TDatabaseServiceCandidate[] }> {
  const candidates = await detectAppDatabaseServicesInContext(context, options.app);

  const chosen = options.serviceName
    ? candidates.find((candidate) => candidate.serviceName === options.serviceName && (!options.type || candidate.type === options.type))
    : candidates[0];

  if (!chosen) {
    throw new Error(`Service '${options.serviceName ?? ""}' was not found among detected database services for ${options.app}`);
  }

  const draft = buildDraftFromCandidate(chosen, {
    region: options.target.region,
    org: options.target.org,
    space: options.target.space,
    app: options.app,
  });

  const profile = await upsertConnectionFromDraft(draft);
  return { profile, candidates };
}
