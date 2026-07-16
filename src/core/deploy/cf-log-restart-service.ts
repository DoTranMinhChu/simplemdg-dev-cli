import { cfExecutionService } from "../cf/cf-execution-service";
import type { TCfExecutionContext } from "../cf/cf-execution-service";

export type TCfLogLine = { raw: string };

/**
 * `cf logs <app> --recent` under the target's isolated CF_HOME. Historically
 * this feature shelled out using one shared person's personal BTP password
 * (see the legacy tool's `.env` USER/PASSWORD) — here it reuses whichever CF
 * target the logged-in user already has (per-user `cf-auth-service`/
 * `cf-execution-service` session), same as every other BTP feature in Studio.
 */
export async function getRecentAppLogs(context: TCfExecutionContext, appName: string): Promise<{ ok: boolean; logs: string; error?: string }> {
  const result = await cfExecutionService.runCf(context, ["logs", appName, "--recent"], { silent: true });
  if (result.exitCode !== 0) {
    return { ok: false, logs: "", error: result.stderr || result.stdout || `cf logs ${appName} --recent failed` };
  }
  return { ok: true, logs: result.stdout };
}

export async function restartApp(context: TCfExecutionContext, appName: string): Promise<{ ok: boolean; output: string; error?: string }> {
  const result = await cfExecutionService.runCf(context, ["restart", appName], { silent: true });
  if (result.exitCode !== 0) {
    return { ok: false, output: result.stdout, error: result.stderr || result.stdout || `cf restart ${appName} failed` };
  }
  return { ok: true, output: result.stdout };
}

export async function getRecentLogsForApps(context: TCfExecutionContext, appNames: string[]): Promise<Record<string, { ok: boolean; logs: string; error?: string }>> {
  const results = await Promise.all(appNames.map(async (appName) => [appName, await getRecentAppLogs(context, appName)] as const));
  return Object.fromEntries(results);
}

export async function restartApps(context: TCfExecutionContext, appNames: string[]): Promise<Record<string, { ok: boolean; output: string; error?: string }>> {
  const results = await Promise.all(appNames.map(async (appName) => [appName, await restartApp(context, appName)] as const));
  return Object.fromEntries(results);
}
