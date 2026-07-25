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
 * Find a HANA/PostgreSQL binding for one CF target by trying its apps in listed order until one
 * yields a database candidate, then import + cache that credential exactly the way CpiQueuePage's
 * app picker does (`buildDraftFromCandidate` + `upsertConnectionFromDraft` — the latter dedupes by
 * app+serviceName+type, so re-discovering the same environment a second time reuses the existing
 * encrypted connection profile instead of creating a duplicate).
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

      const candidateApps = apps.slice(0, MAX_APPS_TO_PROBE);
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
