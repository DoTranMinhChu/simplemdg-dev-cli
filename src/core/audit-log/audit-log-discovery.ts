import { withCfTarget } from "../cf/cf-target-switcher";
import { listAppsInContext, detectAppDatabaseServicesInContext, buildDraftFromCandidate } from "../db/db-btp";
import { upsertConnectionFromDraft } from "../db/db-cache";
import type { TDatabaseServiceCandidate, TDatabaseType } from "../db/db-types";
import { emitJobEvent } from "../tool/studio/job-events";
import type { TJobStep } from "../tool/studio/job-events";

export type TAuditLogDiscoveryStatus = "ready" | "no-app-found" | "no-db-found" | "error";

export type TAuditLogDiscoveryCandidate = {
  cfTargetKey: string;
  region: string;
  org: string;
  space: string;
  status: TAuditLogDiscoveryStatus;
  appName?: string;
  connectionId?: string;
  databaseType?: TDatabaseType;
  serviceName?: string;
  suggestedProjectName: string;
  suggestedEnvLabel: string;
  triedAppCount?: number;
  error?: string;
};

/** Cap how many apps we'll try `cf env` on before giving up — most spaces have well under this many. */
const MAX_APPS_TO_PROBE = 25;

/**
 * A CF space can (and, confirmed on a real customer QAS space, does) contain apps with bound
 * databases that have nothing to do with MDG at all — e.g. `copilot-ai-backend`, an unrelated AI
 * service sitting in the same `mckesson-qas-simplemdg`/`app` space as every real `simplemdg-db-*`/
 * `simplemdg-srv-*` app. Trying apps in whatever order the CF API happens to return them (previously
 * plain listed order) picked exactly that wrong app — its bound HANA instance resolved to zero
 * audit-log tables (it's a different database entirely) and the connection itself was unreachable.
 *
 * Lower number = tried first. The shared "process" service (`*-srv-process-system` in every real
 * environment seen, both this customer's DEV and QAS orgs) exposes by far the richest, most
 * cross-cutting set of audit-log tables — confirmed empirically: probing it alone matched almost
 * every entry in `AUDIT_LOG_CATALOG`, where a single `db-<domain>` app's schema only ever matches a
 * handful of domain-specific entries. Any other `simplemdg`-named app is still strongly preferred
 * over a same-space app with no relation to MDG at all, which is only ever a last-resort fallback
 * (better than reporting "no db found" for a target with an unconventional naming scheme).
 */
function appProbePriority(appName: string): number {
  if (/srv-process-system/i.test(appName)) return 0;
  if (/simplemdg/i.test(appName)) return 1;
  return 2;
}

/**
 * Find a HANA/PostgreSQL binding for one CF target by trying its apps — ordered by
 * `appProbePriority`, most-likely-to-be-the-real-MDG-database first, not raw CF listing order —
 * until one yields a database candidate, then import + cache that credential exactly the way
 * CpiQueuePage's app picker does (`buildDraftFromCandidate` + `upsertConnectionFromDraft` — the
 * latter dedupes by app+serviceName+type, so re-discovering the same environment a second time
 * reuses the existing encrypted connection profile instead of creating a duplicate).
 */
async function discoverOne(targetKey: string): Promise<TAuditLogDiscoveryCandidate> {
  const parts = targetKey.split("::");
  const base = { cfTargetKey: targetKey, region: parts[0] ?? "", org: parts[1] ?? "", space: parts[2] ?? "" };
  const suggestedProjectName = base.org;
  const suggestedEnvLabel = `${base.space} (${base.region})`;

  try {
    return await withCfTarget(targetKey, async (context, target) => {
      const apps = await listAppsInContext(context);
      if (!apps.length) {
        return { ...base, region: target.region, org: target.org, space: target.space, status: "no-app-found" as const, suggestedProjectName: target.org, suggestedEnvLabel: `${target.space} (${target.region})` };
      }

      // Stable sort: ties (e.g. two equally-generic app names) keep the CF API's original relative order.
      const prioritized = apps
        .map((app, index) => ({ app, index }))
        .sort((a, b) => appProbePriority(a.app.name) - appProbePriority(b.app.name) || a.index - b.index)
        .map((entry) => entry.app);
      const candidateApps = prioritized.slice(0, MAX_APPS_TO_PROBE);
      let triedCount = 0;

      for (const app of candidateApps) {
        triedCount += 1;
        let candidates: TDatabaseServiceCandidate[] = [];
        try {
          candidates = await detectAppDatabaseServicesInContext(context, app.name);
        } catch {
          continue;
        }
        if (!candidates.length) continue;

        const chosen = candidates[0];
        const draft = buildDraftFromCandidate(chosen, { region: target.region, org: target.org, space: target.space, app: app.name });
        const profile = await upsertConnectionFromDraft(draft);

        return {
          ...base,
          region: target.region,
          org: target.org,
          space: target.space,
          status: "ready" as const,
          appName: app.name,
          connectionId: profile.id,
          databaseType: chosen.type,
          serviceName: chosen.serviceName,
          suggestedProjectName: target.org,
          suggestedEnvLabel: `${target.space} (${target.region})`,
          triedAppCount: triedCount,
        };
      }

      return {
        ...base,
        region: target.region,
        org: target.org,
        space: target.space,
        status: "no-db-found" as const,
        suggestedProjectName: target.org,
        suggestedEnvLabel: `${target.space} (${target.region})`,
        triedAppCount: triedCount,
      };
    });
  } catch (error) {
    return { ...base, status: "error", suggestedProjectName, suggestedEnvLabel, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Discover a HANA/PostgreSQL connection for every selected CF target in parallel, mirroring
 * `scanCrossRegionTargets`'s per-unit `Promise.all` + progress-event shape. Each target's
 * success/failure is independent — one bad target never fails the batch.
 */
export async function discoverAuditLogEnvironments(targetKeys: string[], options?: { jobId?: string }): Promise<TAuditLogDiscoveryCandidate[]> {
  const jobId = options?.jobId;

  const buildSteps = (statuses: Map<string, TJobStep["status"]>): TJobStep[] =>
    targetKeys.map((key) => ({ key, label: key, status: statuses.get(key) ?? "pending" }));

  const stepStatus = new Map<string, TJobStep["status"]>();
  if (jobId) emitJobEvent({ jobId, type: "job-started", steps: buildSteps(stepStatus) });

  const results = await Promise.all(
    targetKeys.map(async (targetKey) => {
      stepStatus.set(targetKey, "running");
      if (jobId) emitJobEvent({ jobId, type: "job-step", steps: buildSteps(stepStatus) });

      const result = await discoverOne(targetKey);

      stepStatus.set(targetKey, result.status === "ready" ? "success" : result.status === "error" ? "failed" : "skipped");
      if (jobId) emitJobEvent({ jobId, type: "job-step", steps: buildSteps(stepStatus) });

      return result;
    }),
  );

  if (jobId) emitJobEvent({ jobId, type: "job-completed", steps: buildSteps(stepStatus), result: results });

  return results;
}
