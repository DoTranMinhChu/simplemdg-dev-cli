import http from "node:http";
import { getString, getNumber, readJsonBody, sendJson, type TJsonBody } from "../../../studio-shared/studio-server-kit";
import { AUDIT_LOG_CATALOG, findAuditLogDefinition } from "../../../audit-log/audit-log-catalog";
import {
  listAuditLogEnvironments,
  findAuditLogEnvironment,
  upsertAuditLogEnvironment,
  removeAuditLogEnvironment,
  touchAuditLogEnvironmentScan,
} from "../../../audit-log/audit-log-environment-store";
import type { TAuditLogEnvironmentDraft } from "../../../audit-log/audit-log-environment-store";
import { discoverAuditLogEnvironments } from "../../../audit-log/audit-log-discovery";
import { resolveEnvironmentTables, getCachedResolution } from "../../../audit-log/audit-log-table-resolver";
import { queryStatsForDefinition, queryTraceForDefinition, queryDetailTable, countDetailTable } from "../../../audit-log/audit-log-query-service";
import type { TAuditLogDetailFilter } from "../../../audit-log/audit-log-query-service";
import { StudioConnectionPool } from "../../../db/db-connection";
import { emitJobEvent } from "../job-events";

/** One process-wide pool for every Audit Log Monitor query, shared across all registered environments — mirrors DB Studio's own module-scope `pool`. */
const pool = new StudioConnectionPool();

function getStringArray(body: TJsonBody, key: string): string[] {
  const value = body[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getFilters(body: TJsonBody): TAuditLogDetailFilter[] {
  const value = body.filters;
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      column: String(item.column ?? ""),
      op: (["eq", "contains", "gte", "lte"].includes(String(item.op)) ? String(item.op) : "eq") as TAuditLogDetailFilter["op"],
      value: String(item.value ?? ""),
    }))
    .filter((filter) => filter.column && filter.value !== "");
}

async function ensureResolution(connectionId: string, force = false) {
  return resolveEnvironmentTables(connectionId, pool, { force });
}

export async function handleAuditLogApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  const pathname = url.pathname;

  if (pathname === "/api/tool/audit-log/catalog" && method === "GET") {
    sendJson(res, { catalog: AUDIT_LOG_CATALOG });
    return true;
  }

  if (pathname === "/api/tool/audit-log/environments" && method === "GET") {
    sendJson(res, { environments: await listAuditLogEnvironments() });
    return true;
  }

  if (pathname === "/api/tool/audit-log/environments/discover" && method === "POST") {
    const body = await readJsonBody(req);
    const targetKeys = getStringArray(body, "targetKeys");
    const jobId = getString(body, "jobId") || undefined;
    if (!targetKeys.length) {
      sendJson(res, { candidates: [], error: "targetKeys is required" }, 400);
      return true;
    }
    try {
      const candidates = await discoverAuditLogEnvironments(targetKeys, { jobId });
      sendJson(res, { candidates });
    } catch (error) {
      sendJson(res, { candidates: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/tool/audit-log/environments/save" && method === "POST") {
    const body = await readJsonBody(req);
    const draft: TAuditLogEnvironmentDraft = {
      id: getString(body, "id") || undefined,
      projectName: getString(body, "projectName"),
      envLabel: getString(body, "envLabel"),
      cfTargetKey: getString(body, "cfTargetKey"),
      region: getString(body, "region"),
      org: getString(body, "org"),
      space: getString(body, "space"),
      appName: getString(body, "appName"),
      connectionId: getString(body, "connectionId"),
    };
    if (!draft.projectName || !draft.envLabel || !draft.connectionId) {
      sendJson(res, { error: "projectName, envLabel, and connectionId are required" }, 400);
      return true;
    }
    try {
      const environment = await upsertAuditLogEnvironment(draft);
      sendJson(res, { environment });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/tool/audit-log/environments/remove" && method === "POST") {
    const body = await readJsonBody(req);
    const id = getString(body, "id");
    const removed = id ? await removeAuditLogEnvironment(id) : false;
    sendJson(res, { removed });
    return true;
  }

  if (pathname === "/api/tool/audit-log/environments/resolve" && method === "POST") {
    const body = await readJsonBody(req);
    const id = getString(body, "id");
    const force = body.force === true;
    const environment = id ? await findAuditLogEnvironment(id) : undefined;
    if (!environment) {
      sendJson(res, { error: "Environment not found" }, 404);
      return true;
    }
    try {
      const resolution = await ensureResolution(environment.connectionId, force);
      await touchAuditLogEnvironmentScan(environment.id);
      sendJson(res, { resolution });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/tool/audit-log/stats" && method === "POST") {
    const body = await readJsonBody(req);
    const environmentIds = getStringArray(body, "environmentIds");
    const sinceHours = getNumber(body, "sinceHours", 24);
    const jobId = getString(body, "jobId") || undefined;

    if (!environmentIds.length) {
      sendJson(res, { results: [], error: "environmentIds is required" }, 400);
      return true;
    }

    const environments = (await listAuditLogEnvironments()).filter((environment) => environmentIds.includes(environment.id));
    const stepStatus = new Map<string, "pending" | "running" | "success" | "failed">(environments.map((environment) => [environment.id, "pending"]));
    const buildSteps = () => environments.map((environment) => ({ key: environment.id, label: environment.envLabel, status: stepStatus.get(environment.id) ?? "pending" }));

    if (jobId) emitJobEvent({ jobId, type: "job-started", steps: buildSteps() });

    const results = await Promise.all(
      environments.map(async (environment) => {
        stepStatus.set(environment.id, "running");
        if (jobId) emitJobEvent({ jobId, type: "job-step", steps: buildSteps() });

        try {
          const resolution = await ensureResolution(environment.connectionId);
          const cells = await Promise.all(
            AUDIT_LOG_CATALOG.map(async (definition) => {
              const entry = resolution.entries.find((item) => item.catalogId === definition.id);
              const tables = entry?.tables ?? [];
              const cell = await queryStatsForDefinition(environment.connectionId, pool, definition, tables, { sinceHours });
              return [definition.id, cell] as const;
            }),
          );
          stepStatus.set(environment.id, "success");
          if (jobId) emitJobEvent({ jobId, type: "job-step", steps: buildSteps() });
          return { environmentId: environment.id, cells: Object.fromEntries(cells), resolutionError: resolution.error };
        } catch (error) {
          stepStatus.set(environment.id, "failed");
          if (jobId) emitJobEvent({ jobId, type: "job-step", steps: buildSteps() });
          return { environmentId: environment.id, cells: {}, error: error instanceof Error ? error.message : String(error) };
        }
      }),
    );

    if (jobId) emitJobEvent({ jobId, type: "job-completed", steps: buildSteps(), result: results });

    sendJson(res, { results });
    return true;
  }

  if (pathname === "/api/tool/audit-log/trace" && method === "POST") {
    const body = await readJsonBody(req);
    const environmentIds = getStringArray(body, "environmentIds");
    const correlationColumn = getString(body, "correlationColumn");
    const correlationValue = getString(body, "correlationValue");

    if (!environmentIds.length || !correlationColumn || !correlationValue) {
      sendJson(res, { rows: [], error: "environmentIds, correlationColumn, and correlationValue are required" }, 400);
      return true;
    }

    const environments = (await listAuditLogEnvironments()).filter((environment) => environmentIds.includes(environment.id));
    const candidateDefinitions = AUDIT_LOG_CATALOG.filter((definition) => definition.correlationKeys.includes(correlationColumn));

    try {
      const rowsByEnvironment = await Promise.all(
        environments.map(async (environment) => {
          const resolution = await ensureResolution(environment.connectionId);
          const rowsByDefinition = await Promise.all(
            candidateDefinitions.map(async (definition) => {
              const entry = resolution.entries.find((item) => item.catalogId === definition.id);
              const tables = entry?.tables ?? [];
              const rows = await queryTraceForDefinition(environment.connectionId, pool, definition, tables, correlationColumn, correlationValue);
              return rows.map((row) => ({ ...row, environmentId: environment.id, envLabel: `${environment.projectName} / ${environment.envLabel}` }));
            }),
          );
          return rowsByDefinition.flat();
        }),
      );

      sendJson(res, { rows: rowsByEnvironment.flat() });
    } catch (error) {
      sendJson(res, { rows: [], error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  if (pathname === "/api/tool/audit-log/detail" && method === "POST") {
    const body = await readJsonBody(req);
    const environmentId = getString(body, "environmentId");
    const catalogId = getString(body, "catalogId");
    const tableIndex = getNumber(body, "tableIndex", 0);
    const limit = getNumber(body, "limit", 100);
    const offset = getNumber(body, "offset", 0);
    const orderBy = getString(body, "orderBy") || undefined;
    const orderDirection = getString(body, "orderDirection") === "desc" ? "desc" : "asc";
    const filters = getFilters(body);

    const environment = environmentId ? await findAuditLogEnvironment(environmentId) : undefined;
    const definition = catalogId ? findAuditLogDefinition(catalogId) : undefined;
    if (!environment || !definition) {
      sendJson(res, { error: "environmentId and catalogId must reference an existing environment/catalog entry" }, 400);
      return true;
    }

    try {
      const resolution = (await getCachedResolution(environment.connectionId)) ?? (await ensureResolution(environment.connectionId));
      const entry = resolution.entries.find((item) => item.catalogId === catalogId);
      const tables = entry?.tables ?? [];
      const table = tables[tableIndex];
      if (!table) {
        sendJson(res, { error: `No resolved table at index ${tableIndex} for ${definition.displayName} in this environment. Run Resolve first.`, availableTables: tables });
        return true;
      }

      const [result, total] = await Promise.all([
        queryDetailTable(environment.connectionId, pool, table, { limit, offset, filters, orderBy, orderDirection }),
        offset === 0 ? countDetailTable(environment.connectionId, pool, table, filters) : Promise.resolve(undefined),
      ]);

      sendJson(res, { result, total, table, availableTables: tables });
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
    }
    return true;
  }

  return false;
}
