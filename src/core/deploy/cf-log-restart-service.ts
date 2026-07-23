import { cfExecutionService } from "../cf/cf-execution-service";
import type { TCfExecutionContext } from "../cf/cf-execution-service";
import { readAppVcapServicesInContext } from "../db/db-btp";

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

/**
 * Find the SAP Cloud Logging Dashboards (OpenSearch/Kibana-equivalent) URL for an app, if it's
 * bound to one — this is the SAME backing store as BTP Cockpit's "Logs and Traces" / "Request &
 * Log" view, which retains far more history than `cf logs --recent`'s short Loggregator buffer.
 * There is no way to query that history from here directly: the app's own service-key credentials
 * are ingest-only (confirmed — non-ingestion paths 404 at the reverse proxy before ever reaching
 * OpenSearch) and the dashboards endpoint itself requires interactive SAML SSO, so the best this
 * can do is hand back a one-click link into that login flow instead of a raw hostname to copy.
 */
export async function getCloudLoggingDashboardLink(context: TCfExecutionContext, appName: string): Promise<{ url?: string; serviceName?: string }> {
  const vcapServices = await readAppVcapServicesInContext(context, appName).catch(() => undefined);
  if (!vcapServices || typeof vcapServices !== "object") return {};
  const entries = (vcapServices as Record<string, unknown>)["cloud-logging"];
  if (!Array.isArray(entries) || !entries.length) return {};
  const credentials = (entries[0] as { credentials?: Record<string, unknown> }).credentials;
  const dashboardsEndpoint = credentials && typeof credentials["dashboards-endpoint"] === "string" ? (credentials["dashboards-endpoint"] as string) : undefined;
  if (!dashboardsEndpoint) return {};
  const serviceName = (entries[0] as { name?: string }).name;
  return { url: `https://${dashboardsEndpoint}`, serviceName };
}
