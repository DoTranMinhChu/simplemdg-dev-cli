import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { runCommand } from "../process";
import { readCache } from "../cache";
import { inferCloudFoundryRegionFromApiEndpoint } from "../cf";
import { decryptCfPassword } from "./cf-auth-service";
import type { TCfTarget } from "./cf-target.types";

export type TCfExecutionContext = {
  region: string;
  apiEndpoint: string;
  cfHome: string;
};

export type TCfCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

const CF_HOME_ROOT = path.join(os.homedir(), ".simplemdg", "cf-home");

let debugCf = false;

/** Toggle verbose CF execution logging (enabled by `smdg cf db studio --debug-cf`). */
export function setCfDebug(enabled: boolean): void {
  debugCf = enabled;
}

export function isCfDebug(): boolean {
  return debugCf;
}

/** Isolated CF_HOME directory for a region so background work never mutates the
 * developer's normal terminal `cf target`. */
export function getCfHomeForRegion(region: string): string {
  const safe = (region || "default").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  return path.join(CF_HOME_ROOT, safe);
}

/**
 * Minimal per-key mutex: a promise chain that serializes async sections sharing
 * the same key. Used to serialize all CF commands within one region (the CF CLI
 * mutates per-CF_HOME config files, so concurrent commands corrupt each other).
 */
class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  public runExclusive<T>(action: () => Promise<T>): Promise<T> {
    const run = this.tail.then(action, action);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const cfRegionMutexMap = new Map<string, Mutex>();

function getRegionMutex(region: string): Mutex {
  let mutex = cfRegionMutexMap.get(region);
  if (!mutex) {
    mutex = new Mutex();
    cfRegionMutexMap.set(region, mutex);
  }
  return mutex;
}

function redactArgsForLog(args: string[]): string {
  // `cf auth <user> <password>` — never log the password.
  if (args[0] === "auth") {
    return ["auth", args[1] ?? "", "***"].join(" ");
  }
  if (args[0] === "login") {
    return args.map((arg, index) => (index > 0 && /^-p$/.test(args[index - 1]) ? "***" : arg)).join(" ");
  }
  return args.join(" ");
}

export class CfExecutionService {
  /**
   * Run a single `cf` command bound to the context's isolated CF_HOME. Output is
   * captured (never inherited) so background work stays silent unless debug mode
   * is on.
   */
  public async runCf(
    context: TCfExecutionContext,
    args: string[],
    options?: { silent?: boolean },
  ): Promise<TCfCommandResult> {
    await fs.ensureDir(context.cfHome).catch(() => undefined);

    if (debugCf) {
      console.log(`[cf ${context.region}] cf ${redactArgsForLog(args)}`);
    }

    const result = await runCommand("cf", args, { env: { CF_HOME: context.cfHome } });

    if (debugCf && !options?.silent) {
      if (result.stdout) console.log(`[cf ${context.region}] ${result.stdout}`);
      if (result.stderr) console.error(`[cf ${context.region}] ${result.stderr}`);
    }

    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
  }

  /**
   * Point the context's CF_HOME at `apiEndpoint`, ensure an authenticated
   * session (auto re-login from cached credentials), then run `action`. All
   * commands for the same region are serialized via that region's mutex; calls
   * for different regions may run in parallel.
   */
  public runInRegion<T>(
    region: string,
    apiEndpoint: string,
    action: (context: TCfExecutionContext) => Promise<T>,
  ): Promise<T> {
    const context: TCfExecutionContext = { region, apiEndpoint, cfHome: getCfHomeForRegion(region) };
    return getRegionMutex(region).runExclusive(async () => {
      const apiResult = await this.runCf(context, ["api", apiEndpoint], { silent: true });
      if (apiResult.exitCode !== 0) {
        throw new Error(`Cannot reach CF API ${apiEndpoint}: ${(apiResult.stderr || apiResult.stdout || "").trim()}`);
      }
      await this.ensureCfLoggedIn(context);
      return action(context);
    });
  }

  /**
   * Like `runInRegion`, but skips `ensureCfLoggedIn`. Used for first-time login
   * (e.g. `loginCfWithPassword`), where there is no cached credential yet to
   * auto-login with — calling `ensureCfLoggedIn` here would just fail before the
   * caller gets a chance to `cf auth` with the credentials the user just typed.
   * Still points the isolated CF_HOME at `apiEndpoint` and serializes via the
   * region's mutex.
   */
  public runInRegionWithoutAutoLogin<T>(
    region: string,
    apiEndpoint: string,
    action: (context: TCfExecutionContext) => Promise<T>,
  ): Promise<T> {
    const context: TCfExecutionContext = { region, apiEndpoint, cfHome: getCfHomeForRegion(region) };
    return getRegionMutex(region).runExclusive(async () => {
      const apiResult = await this.runCf(context, ["api", apiEndpoint], { silent: true });
      if (apiResult.exitCode !== 0) {
        throw new Error(`Cannot reach CF API ${apiEndpoint}: ${(apiResult.stderr || apiResult.stdout || "").trim()}`);
      }
      return action(context);
    });
  }

  /**
   * Resolve a target key, switch the isolated CF_HOME to that org/space, and run
   * `action`. Because each region uses its own CF_HOME, this never disturbs the
   * developer's global `cf target` and there is nothing to restore afterwards.
   */
  public async withCfTarget<T>(
    targetKey: string,
    action: (context: TCfExecutionContext, target: TCfTarget) => Promise<T>,
  ): Promise<T> {
    // Lazy import to avoid a static import cycle with cf-target-switcher.
    const { parseCfTargetKey, findTargetByKey } = await import("./cf-target-switcher");
    const parts = parseCfTargetKey(targetKey);
    const target = await findTargetByKey(targetKey);

    if (!target || !target.apiEndpoint) {
      throw new Error(
        `Target ${parts.region} / ${parts.org} / ${parts.space} not found in cache. Refresh cross-region targets first (smdg cf org --refresh).`,
      );
    }

    return this.runInRegion(target.region, target.apiEndpoint, async (context) => {
      const orgResult = await this.runCf(context, ["target", "-o", target.org], { silent: true });
      if (orgResult.exitCode !== 0) {
        throw new Error(`Cannot target CF org ${target.org} in ${target.region}: ${(orgResult.stderr || orgResult.stdout || "").trim()}`);
      }
      if (target.space) {
        const spaceResult = await this.runCf(context, ["target", "-s", target.space], { silent: true });
        if (spaceResult.exitCode !== 0) {
          throw new Error(`Cannot target CF space ${target.space} in org ${target.org}: ${(spaceResult.stderr || spaceResult.stdout || "").trim()}`);
        }
      }
      return action(context, target);
    });
  }

  /**
   * Ensure the context's CF_HOME has a usable session. Checks `cf orgs`; if not
   * authenticated, silently re-logs in using cached SimpleMDG credentials
   * (passwords decrypted in-process, never logged). Throws a clear, actionable
   * error when no cached credential works. Never prompts.
   */
  public async ensureCfLoggedIn(context: TCfExecutionContext): Promise<void> {
    const orgsCheck = await this.runCf(context, ["orgs"], { silent: true });
    if (orgsCheck.exitCode === 0) {
      return;
    }

    const cache = await readCache();
    const region = context.region || inferCloudFoundryRegionFromApiEndpoint(context.apiEndpoint);
    const profiles = cache.cloudFoundry.loginProfiles.filter((profile) => profile.password?.trim());

    // Prefer credentials saved for this endpoint, then any other.
    const ordered = [
      ...profiles.filter((profile) => profile.apiEndpoint === context.apiEndpoint),
      ...profiles.filter((profile) => profile.apiEndpoint !== context.apiEndpoint),
    ];

    if (!ordered.length) {
      throw new Error(`Cloud Foundry login is required for ${region}. Run: smdg cf login`);
    }

    let lastError = orgsCheck.stderr || orgsCheck.stdout || "cf orgs failed";
    const tried = new Set<string>();

    for (const profile of ordered) {
      const id = `${profile.username}|${profile.password}`;
      if (tried.has(id)) continue;
      tried.add(id);

      const password = decryptCfPassword(profile.password as string);
      const authResult = await this.runCf(context, ["auth", profile.username, password], { silent: true });
      if (authResult.exitCode !== 0) {
        lastError = `cf auth failed for ${profile.username}`;
        continue;
      }

      const recheck = await this.runCf(context, ["orgs"], { silent: true });
      if (recheck.exitCode === 0) {
        return;
      }
      lastError = recheck.stderr || recheck.stdout || lastError;
    }

    throw new Error(`Automatic CF login failed for ${region}. ${lastError}. Run: smdg cf login and update the cached password.`);
  }
}

/** Shared singleton used across Studio, CLI, and the cross-region scanner. */
export const cfExecutionService = new CfExecutionService();
