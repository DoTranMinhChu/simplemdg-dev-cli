import http from "node:http";
import chalk from "chalk";
import { getDirname } from "../esm-paths";
import {
  findAvailablePort,
  openBrowser,
  readJsonBody,
  reportStudioStartupLine,
  resolveStudioDistPath,
  sendJson,
  sendText,
  serveStudioAsset as serveStudioAssetFromKit,
  getString,
  getNumber,
  type TJsonBody,
  type TStudioLogFn,
} from "../studio-shared/studio-server-kit";
import { StudioConnectionPool } from "./db-connection";
import { classifyDatabaseError } from "./db-error";
import {
  duplicateConnection,
  findConnectionProfile,
  getResolvedConnection,
  listPublicConnections,
  removeConnection,
  renameConnection,
  updateConnectionFields,
  upsertConnectionFromDraft,
} from "./db-cache";
import type { TConnectionDraft, TConnectionFieldPatch } from "./db-cache";
import { testConnectionProfile } from "./db-connection";
import {
  analyzeSqlSafety,
  appendSafeLimit,
  generateCountSql,
  generateCreateTableDdl,
  generateSelectSql,
  looksLikeProduction,
} from "./db-metadata";
import type { TGridSortState, TResolvedDatabaseConnection, TStudioWorkspaceState, TTableChangeSet } from "./db-types";
import {
  deleteSavedQuery,
  listSavedQueries,
  renameSavedQuery,
  saveQuery,
} from "./db-query-files";
import { deleteRow, insertRow, saveTableChanges, updateRow } from "./db-row";
import { appendQueryHistory, listQueryHistory } from "./db-query-history";
import { readWorkspace, writeWorkspace } from "./studio/workspace-cache";
import { readStudioSettings, writeStudioSettings } from "./studio/studio-settings";
import {
  formatSql,
  generateInsertTemplate,
  generateTableQuery,
  generateUpdateTemplate,
  splitStatements,
} from "./studio/sql-formatter";
import {
  buildDraftFromCandidate,
  detectAppDatabaseServices,
  detectAppDatabaseServicesInContext,
  ensureCloudFoundrySession,
  getCloudFoundryTargetSummary,
  importConnectionFromApp,
  importConnectionFromAppInContext,
  listAppsInContext,
} from "./db-btp";
import { onCacheEvent, formatRelativeTime, computeCacheStatus, refreshCache, DEFAULT_CACHE_TTL } from "../cache/smart-cache";
import { readAllEntries, readEntry } from "../cache/smart-cache-store";
import { listFavoriteTargets, listRecentTargets, addFavoriteTarget, removeFavoriteTarget, addRecentTarget } from "../cf/cf-target-cache";
import { cfTargetKey, isValidCfTarget } from "../cf/cf-target.types";
import type { TCfTarget } from "../cf/cf-target.types";
import { listCrossRegionTargets, listCrossRegionOrgSummaries, getCrossRegionStatus, scanCrossRegionTargets } from "../cf/cf-cross-region-scanner";
import type { TCfScanCredential } from "../cf/cf-cross-region-scanner";
import { withCfTarget, parseCfTargetKey } from "../cf/cf-target-switcher";
import { getCfAuthStatus, loginCfWithPassword, cfLogout } from "../cf/cf-auth-service";
import { setCfDebug } from "../cf/cf-execution-service";
import { listRegions } from "../cf/cf-region-registry";
import { readCache } from "../cache";
import type { TDatabaseErrorInfo, TDatabaseErrorKind, TDatabaseObjectKind, TDatabaseType } from "./db-types";
import type { TSmartCacheEntry } from "../cache/smart-cache.types";

export type TStudioServerOptions = {
  port?: number;
  readOnly?: boolean;
  queryTimeoutMs?: number;
  debugCf?: boolean;
  /** Serve only the JSON/SSE API — no static UI, no browser auto-open. Used by `--dev-ui`/`--api-only` so a separately-run Vite dev server owns the frontend. */
  apiOnly?: boolean;
  onLog?: TStudioLogFn;
};

const __dirname = getDirname(import.meta.url);

const STUDIO_NOT_BUILT_HTML =
  "<!doctype html><html><body style=\"font-family:sans-serif;padding:40px;color:#334\"><h2>CF DB Studio UI is not built</h2>" +
  "<p>Run <code>npm run build:studio</code> (or <code>npm run build</code>) from the repository root, then restart <code>smdg cf db studio</code>.</p>" +
  "<p>For frontend development, run <code>smdg cf db studio --dev-ui</code> and follow the printed instructions.</p></body></html>";

/** Serve the built React Studio (SPA fallback: unknown paths without a file extension resolve to index.html). */
async function serveStudioAsset(pathname: string, res: http.ServerResponse): Promise<void> {
  await serveStudioAssetFromKit({
    distPath: await resolveStudioDistPath(__dirname),
    pathname,
    res,
    fallbackHtmlFileName: "index.html",
    notBuiltMessageHtml: STUDIO_NOT_BUILT_HTML,
  });
}

export type TStudioServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

function toCsv(fields: string[], rows: Array<Record<string, unknown>>): string {
  const escapeCell = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };

  const header = fields.map(escapeCell).join(",");
  const lines = rows.map((row) => fields.map((field) => escapeCell(row[field])).join(","));
  return [header, ...lines].join("\n");
}

const VALID_ENVIRONMENTS = new Set(["DEV", "QAS", "PROD", "SANDBOX", "CUSTOM"]);

function getEnvironment(body: TJsonBody): TConnectionDraft["environment"] {
  const value = getString(body, "environment").toUpperCase();
  return VALID_ENVIRONMENTS.has(value) ? (value as TConnectionDraft["environment"]) : undefined;
}

/** Detect environment label from org/space name (heuristic). */
function detectEnvironment(org: string, space: string): string {
  const haystack = `${org} ${space}`.toLowerCase();
  if (/\bprod\b|production|prd|\blive\b/.test(haystack)) return "PROD";
  if (/\bqas\b|quality|staging|uat/.test(haystack)) return "QAS";
  if (/\bdev\b|development|\blocal\b/.test(haystack)) return "DEV";
  if (/\bsandbox\b|sbx/.test(haystack)) return "SANDBOX";
  return "";
}

/**
 * Build a serialisable summary for a cached target from the cf-apps namespace
 * entry (or just target metadata if no apps are cached).
 */
function buildTargetSummary(target: TCfTarget, appsEntry?: TSmartCacheEntry<unknown[]> | undefined): Record<string, unknown> {
  const env = detectEnvironment(target.org, target.space);
  const cacheStatus = appsEntry ? computeCacheStatus(appsEntry) : "missing";
  const appCount = appsEntry ? (Array.isArray(appsEntry.data) ? appsEntry.data.length : 0) : undefined;
  return {
    region: target.region,
    apiEndpoint: target.apiEndpoint,
    org: target.org,
    space: target.space,
    key: cfTargetKey(target),
    isFavorite: target.isFavorite ?? false,
    lastUsedAt: target.lastUsedAt,
    environment: env,
    cachedAppCount: appCount,
    cacheStatus,
    updatedAt: appsEntry?.updatedAt,
    updatedAgo: formatRelativeTime(appsEntry?.updatedAt),
  };
}

/** Resolve cached CF login credentials for the cross-region scanner. */
async function resolveCfScanCredentials(): Promise<TCfScanCredential[]> {
  const cache = await readCache();
  return cache.cloudFoundry.loginProfiles.map((profile) => ({
    apiEndpoint: profile.apiEndpoint,
    username: profile.username,
    password: profile.password,
  }));
}

function draftFromBody(body: TJsonBody): TConnectionDraft {
  const type = getString(body, "type") === "hana" ? "hana" : "postgresql";
  return {
    name: getString(body, "name") || `${type} connection`,
    color: getString(body, "color") || undefined,
    environment: getEnvironment(body),
    isFavorite: body.isFavorite === undefined ? undefined : Boolean(body.isFavorite),
    type,
    host: getString(body, "host"),
    port: getNumber(body, "port", type === "hana" ? 443 : 5432),
    database: getString(body, "database") || undefined,
    schema: getString(body, "schema") || undefined,
    username: getString(body, "username"),
    password: getString(body, "password"),
    ssl: body.ssl === undefined ? true : Boolean(body.ssl),
    sslValidateCertificate: Boolean(body.sslValidateCertificate),
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
  };
}

function getObject(body: TJsonBody, key: string): Record<string, unknown> {
  const value = body[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function resolvedFromDraft(draft: TConnectionDraft): TResolvedDatabaseConnection {
  const now = new Date().toISOString();
  return {
    id: "draft",
    name: draft.name,
    type: draft.type,
    host: draft.host,
    port: draft.port,
    database: draft.database,
    schema: draft.schema,
    username: draft.username,
    password: draft.password,
    ssl: draft.ssl,
    sslValidateCertificate: draft.sslValidateCertificate,
    createdAt: now,
    updatedAt: now,
  };
}

export async function startStudioServer(options: TStudioServerOptions = {}): Promise<TStudioServerHandle> {
  // Background CF work runs silently unless debug mode is explicitly enabled.
  setCfDebug(options.debugCf ?? false);
  const preferredPort = options.port && options.port > 0 ? options.port : 45888;
  const port = await findAvailablePort(preferredPort);
  const pool = new StudioConnectionPool({ queryTimeoutMs: options.queryTimeoutMs });
  const serverReadOnlyDefault = options.readOnly ?? false;

  // HTTP status per DB error kind: 503 for transient connectivity issues (the
  // caller can safely retry), 401/403 for credential/authorization problems,
  // 400 for bad input (SQL syntax), 500 reserved for truly unexpected bugs.
  const statusForErrorKind = (kind: TDatabaseErrorKind): number => {
    switch (kind) {
      case "network":
      case "timeout":
        return 503;
      case "authentication":
      case "stale-credential":
        return 401;
      case "permission":
        return 403;
      case "syntax":
        return 400;
      default:
        return 500;
    }
  };

  // Only offer recovery actions that can plausibly fix that class of error —
  // e.g. retrying a syntax error changes nothing, so it gets none.
  const recoveryActionsForErrorKind = (kind: TDatabaseErrorKind): Array<"retry" | "reconnect" | "refresh-from-btp" | "close-connection"> => {
    switch (kind) {
      case "network":
      case "timeout":
        return ["retry", "reconnect", "refresh-from-btp"];
      case "authentication":
      case "stale-credential":
        return ["reconnect", "refresh-from-btp", "close-connection"];
      case "permission":
        return ["reconnect", "close-connection"];
      case "syntax":
        return [];
      default:
        return ["retry", "close-connection"];
    }
  };

  // Resolve the classified error for a connection (the pool records it on the
  // connection state) into the recovery-aware shape the UI expects, plus the
  // HTTP status to send it with.
  const buildAdapterError = (connectionId: string, error: unknown): {
    payload: { error: string; errorInfo: TDatabaseErrorInfo; recoveryActions: string[] };
    status: number;
  } => {
    const state = pool.getConnectionStatus(connectionId);
    // Prefer the pool's classification (it knows the adapter type, e.g. HANA
    // vs PostgreSQL, for a more specific message); fall back to classifying
    // the caught error directly if no state was ever recorded for this id
    // (e.g. the connection profile itself couldn't be resolved).
    const errorInfo: TDatabaseErrorInfo = state?.lastError ?? classifyDatabaseError(error, "postgresql");
    return {
      payload: { error: errorInfo.message, errorInfo, recoveryActions: recoveryActionsForErrorKind(errorInfo.kind) },
      status: statusForErrorKind(errorInfo.kind),
    };
  };

  const sendAdapterError = (res: http.ServerResponse, connectionId: string, error: unknown): void => {
    const built = buildAdapterError(connectionId, error);
    sendJson(res, built.payload, built.status);
  };

  const router = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    if (pathname === "/" && method === "GET") {
      if (options.apiOnly) {
        sendJson(res, { error: "This server is running in --api-only mode. Start the Vite dev server separately: cd studio && npm run dev" }, 404);
        return;
      }
      await serveStudioAsset(pathname, res);
      return;
    }

    // Server-Sent Events: stream smart-cache background-refresh notifications.
    if (pathname === "/api/events" && method === "GET") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n");
      const unsubscribe = onCacheEvent((event) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });
      const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
      req.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    // --- Connections ---------------------------------------------------------
    if (pathname === "/api/connections" && method === "GET") {
      sendJson(res, { connections: await listPublicConnections() });
      return;
    }

    if (pathname === "/api/connections/test" && method === "POST") {
      const body = await readJsonBody(req);
      const resolved = await getResolvedConnection(getString(body, "connectionId"));
      const result = await testConnectionProfile(resolved, { queryTimeoutMs: options.queryTimeoutMs });
      sendJson(res, result);
      return;
    }

    if (pathname === "/api/connections/test-draft" && method === "POST") {
      const body = await readJsonBody(req);
      const result = await testConnectionProfile(resolvedFromDraft(draftFromBody(body)), { queryTimeoutMs: options.queryTimeoutMs });
      sendJson(res, result);
      return;
    }

    if (pathname === "/api/connections/create" && method === "POST") {
      const body = await readJsonBody(req);
      const profile = await upsertConnectionFromDraft(draftFromBody(body));
      const { encryptedPassword: _omit, ...publicProfile } = profile;
      void _omit;
      sendJson(res, { connection: publicProfile });
      return;
    }

    if (pathname === "/api/connections/rename" && method === "POST") {
      const body = await readJsonBody(req);
      const profile = await renameConnection(getString(body, "id"), getString(body, "name"));
      sendJson(res, { id: profile.id, name: profile.name });
      return;
    }

    if (pathname === "/api/connections/update" && method === "POST") {
      const body = await readJsonBody(req);
      const patch: TConnectionFieldPatch = {};
      if (typeof body.name === "string") patch.name = body.name;
      if (typeof body.color === "string") patch.color = body.color;
      if (body.environment !== undefined) patch.environment = getEnvironment(body);
      if (body.isFavorite !== undefined) patch.isFavorite = Boolean(body.isFavorite);
      if (Array.isArray(body.tags)) patch.tags = body.tags as string[];
      const profile = await updateConnectionFields(getString(body, "id"), patch);
      const { encryptedPassword: _omit, ...publicProfile } = profile;
      void _omit;
      sendJson(res, { connection: publicProfile });
      return;
    }

    if (pathname === "/api/connections/duplicate" && method === "POST") {
      const body = await readJsonBody(req);
      const profile = await duplicateConnection(getString(body, "id"));
      sendJson(res, { id: profile.id, name: profile.name });
      return;
    }

    if (pathname === "/api/connections/remove" && method === "POST") {
      const body = await readJsonBody(req);
      await pool.closeConnection(getString(body, "id"));
      const removed = await removeConnection(getString(body, "id"));
      sendJson(res, { removed });
      return;
    }

    if (pathname === "/api/connections/import-from-app" && method === "POST") {
      const body = await readJsonBody(req);
      const targetKey = getString(body, "targetKey");
      const importArgs = {
        app: getString(body, "app"),
        serviceName: getString(body, "serviceName") || undefined,
        type: (getString(body, "type") || undefined) as TDatabaseType | undefined,
      };
      // When a cross-region targetKey is supplied, run the import (cf env) under
      // that target's isolated CF_HOME and record its region/org/space.
      const { profile } = targetKey
        ? await withCfTarget(targetKey, (context, target) => importConnectionFromAppInContext(context, {
            ...importArgs,
            target: { region: target.region, org: target.org, space: target.space },
          }))
        : await importConnectionFromApp(importArgs);
      const { encryptedPassword: _omitPassword, ...publicProfile } = profile;
      void _omitPassword;
      sendJson(res, { connection: publicProfile });
      return;
    }

    // --- Connection lifecycle ------------------------------------------------

    if (pathname === "/api/connections/reconnect" && method === "POST") {
      const body = await readJsonBody(req);
      const id = getString(body, "connectionId");
      const result = await pool.reconnectConnection(id);
      const state = pool.getConnectionStatus(id);
      sendJson(res, { ...result, status: state?.status, errorInfo: state?.lastError });
      return;
    }

    if (pathname === "/api/connections/close" && method === "POST") {
      const body = await readJsonBody(req);
      await pool.invalidateConnection(getString(body, "connectionId"));
      sendJson(res, { ok: true });
      return;
    }

    if (pathname === "/api/connections/status" && method === "GET") {
      const id = url.searchParams.get("connectionId");
      if (id) {
        const state = pool.getConnectionStatus(id);
        sendJson(res, { connectionId: id, status: state?.status ?? "disconnected", lastUsedAt: state?.lastUsedAt, errorInfo: state?.lastError });
      } else {
        sendJson(res, { statuses: pool.listConnectionStatuses() });
      }
      return;
    }

    if (pathname === "/api/connections/refresh-from-btp" && method === "POST") {
      const body = await readJsonBody(req);
      const id = getString(body, "connectionId");
      const conn = await findConnectionProfile(id);
      if (!conn) {
        sendJson(res, { ok: false, error: "Connection not found." });
        return;
      }
      if (!conn.app || !conn.region || !conn.org || !conn.space) {
        sendJson(res, { ok: false, error: "This connection was not imported from a BTP app (missing region/org/space/app)." });
        return;
      }
      const targetKey = `${conn.region}::${conn.org}::${conn.space}`;
      try {
        // Re-read cf env under the connection's isolated target and refresh the
        // encrypted credentials in place, preserving name/color/environment.
        const candidates = await withCfTarget(targetKey, (context) => detectAppDatabaseServicesInContext(context, conn.app as string));
        const chosen = conn.serviceName
          ? candidates.find((candidate) => candidate.serviceName === conn.serviceName && candidate.type === conn.type)
          : candidates[0];
        if (!chosen) {
          sendJson(res, { ok: false, error: `Service '${conn.serviceName ?? ""}' was not found in ${conn.app} env.` });
          return;
        }
        const draft = buildDraftFromCandidate(chosen, { region: conn.region, org: conn.org, space: conn.space, app: conn.app });
        draft.id = conn.id;
        draft.name = conn.name;
        draft.environment = conn.environment;
        draft.color = conn.color;
        draft.isFavorite = conn.isFavorite;
        const profile = await upsertConnectionFromDraft(draft);
        await pool.invalidateConnection(id);
        const test = await pool.testConnection(id).catch((error) => ({ success: false, message: error instanceof Error ? error.message : String(error), durationMs: 0 }));
        const { encryptedPassword: _omitRefresh, ...publicProfile } = profile;
        void _omitRefresh;
        sendJson(res, { ok: true, connection: publicProfile, test });
      } catch (error) {
        sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    // --- CF Auth -------------------------------------------------------------

    if (pathname === "/api/cf/auth-status" && method === "GET") {
      const status = await getCfAuthStatus();
      sendJson(res, status);
      return;
    }

    if (pathname === "/api/cf/login" && method === "POST") {
      const body = await readJsonBody(req);
      const result = await loginCfWithPassword({
        apiEndpoint: getString(body, "apiEndpoint"),
        region: getString(body, "region") || undefined,
        username: getString(body, "username"),
        password: getString(body, "password"),
        remember: body.remember !== false,
      });
      if (result.success) {
        // Kick off a background cross-region scan so the wizard populates after login.
        void scanCrossRegionTargets({ credentials: await resolveCfScanCredentials() }).catch(() => undefined);
      }
      sendJson(res, result);
      return;
    }

    if (pathname === "/api/cf/logout" && method === "POST") {
      const body = await readJsonBody(req);
      const result = await cfLogout({ clearCachedCredentials: body.clearCachedCredentials === true });
      sendJson(res, result);
      return;
    }

    if (pathname === "/api/cf/regions" && method === "GET") {
      const regions = await listRegions();
      sendJson(res, { regions: regions.filter((r) => r.enabled || r.isCustom) });
      return;
    }

    // --- BTP -----------------------------------------------------------------
    // -------- Multi-target BTP routes (smart cache first) -------------------

    if (pathname === "/api/btp/targets" && method === "GET") {
      const favTargets = await listFavoriteTargets();
      const recentTargets = await listRecentTargets(10);
      const appsEntries = await readAllEntries<unknown[]>("cf-apps");
      const favKeys = new Set(favTargets.map((t) => cfTargetKey(t)));

      // Primary source: cross-region target cache. Fall back to keys seen in the
      // cf-apps cache (only valid 3-part keys with non-empty space).
      const crossRegion = await listCrossRegionTargets();
      const orgSummaries = await listCrossRegionOrgSummaries();

      const allFromApps: TCfTarget[] = [];
      for (const key of Object.keys(appsEntries)) {
        const parts = key.split("::");
        if (parts.length === 3 && parts[0]?.trim() && parts[1]?.trim() && parts[2]?.trim()) {
          allFromApps.push({ region: parts[0], apiEndpoint: "", org: parts[1], space: parts[2] });
        }
      }

      const targetMap = new Map<string, TCfTarget>();
      for (const t of [...crossRegion, ...favTargets, ...recentTargets, ...allFromApps]) {
        if (!isValidCfTarget(t)) continue;
        const k = cfTargetKey(t);
        if (!targetMap.has(k)) targetMap.set(k, t);
      }
      const allTargets = Array.from(targetMap.values());

      const byRegion: Record<string, unknown[]> = {};
      for (const t of allTargets) {
        if (!byRegion[t.region]) byRegion[t.region] = [];
        const appsEntry = appsEntries[cfTargetKey(t)] as TSmartCacheEntry<unknown[]> | undefined;
        byRegion[t.region].push(buildTargetSummary({ ...t, isFavorite: favKeys.has(cfTargetKey(t)) }, appsEntry));
      }

      // Group org summaries (no-spaces / spaces-failed) by region for the UI.
      const noSpaceByRegion: Record<string, Array<{ org: string; status: string; error?: string }>> = {};
      for (const summary of orgSummaries) {
        if (summary.status !== "spaces-loaded") {
          if (!noSpaceByRegion[summary.region]) noSpaceByRegion[summary.region] = [];
          noSpaceByRegion[summary.region].push({ org: summary.org, status: summary.status, error: summary.error });
        }
      }

      const regionStatus = await getCrossRegionStatus();
      sendJson(res, {
        favorites: favTargets.map((t) => buildTargetSummary(t, appsEntries[cfTargetKey(t)] as TSmartCacheEntry<unknown[]> | undefined)),
        recent: recentTargets.map((t) => buildTargetSummary(t, appsEntries[cfTargetKey(t)] as TSmartCacheEntry<unknown[]> | undefined)),
        byRegion,
        noSpaceByRegion,
        totalTargets: allTargets.length,
        regions: Object.keys(byRegion).sort(),
        regionStatus: regionStatus.regions,
        lastUpdatedAt: regionStatus.lastUpdatedAt,
        lastUpdatedAgo: formatRelativeTime(regionStatus.lastUpdatedAt),
      });
      return;
    }

    if (pathname === "/api/btp/targets/refresh" && method === "POST") {
      // Trigger a background cross-region scan; respond immediately. Progress is
      // streamed over /api/events. Credentials are resolved server-side.
      void scanCrossRegionTargets({ credentials: await resolveCfScanCredentials() }).catch(() => undefined);
      sendJson(res, { ok: true, started: true });
      return;
    }

    if (pathname === "/api/btp/apps" && method === "GET") {
      const targetKey = url.searchParams.get("targetKey") ?? "";
      const forceRefresh = url.searchParams.get("refresh") === "true";
      if (!targetKey) { sendJson(res, { apps: [], cacheStatus: "missing", error: "targetKey required" }); return; }

      let parts: { region: string; org: string; space: string };
      try {
        parts = parseCfTargetKey(targetKey);
      } catch (error) {
        sendJson(res, { apps: [], cacheStatus: "missing", error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const targetCtx = { region: parts.region, org: parts.org, space: parts.space };

      const entry = await readEntry<unknown[]>("cf-apps", targetKey);
      const cacheStatus = entry ? computeCacheStatus(entry) : "missing";

      // Fetcher always runs CF commands IN THE CONTEXT of the selected target
      // (isolated CF_HOME via the execution service).
      const fetchApps = () => withCfTarget(targetKey, (context) => listAppsInContext(context));

      // Cache-first: return cached apps immediately and refresh in background.
      if (entry && !forceRefresh) {
        const refreshPromise = refreshCache({ namespace: "cf-apps", key: targetKey, ttlMs: DEFAULT_CACHE_TTL.cfApps, resource: "cf-apps", fetcher: fetchApps });
        refreshPromise.catch(() => undefined);
        sendJson(res, { targetKey, target: targetCtx, apps: entry.data, cacheStatus, fromCache: true, isRefreshing: true, updatedAt: entry.updatedAt, updatedAgo: formatRelativeTime(entry.updatedAt) });
        return;
      }

      // No cache (or forced): switch to target and fetch live.
      try {
        const apps = await refreshCache({ namespace: "cf-apps", key: targetKey, ttlMs: DEFAULT_CACHE_TTL.cfApps, resource: "cf-apps", fetcher: fetchApps });
        sendJson(res, { targetKey, target: targetCtx, apps, cacheStatus: "fresh", fromCache: false, isRefreshing: false, updatedAt: new Date().toISOString() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (entry) {
          sendJson(res, { targetKey, target: targetCtx, apps: entry.data, cacheStatus: "stale", fromCache: true, isRefreshing: false, updatedAt: entry.updatedAt, updatedAgo: formatRelativeTime(entry.updatedAt), warning: `Refresh failed; showing cached apps. ${message}` });
        } else {
          sendJson(res, { targetKey, target: targetCtx, apps: [], cacheStatus: "missing", fromCache: false, isRefreshing: false, error: message });
        }
      }
      return;
    }

    if (pathname === "/api/btp/db-candidates" && method === "GET") {
      const targetKey = url.searchParams.get("targetKey") ?? "";
      const appName = url.searchParams.get("appName") ?? "";
      if (!targetKey || !appName) { sendJson(res, { candidates: [], cacheStatus: "missing", error: "targetKey and appName required" }); return; }

      let parts: { region: string; org: string; space: string };
      try {
        parts = parseCfTargetKey(targetKey);
      } catch (error) {
        sendJson(res, { candidates: [], cacheStatus: "missing", error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const targetCtx = { region: parts.region, org: parts.org, space: parts.space };
      const candidateKey = `${targetKey}::${appName}`;
      const forceRefresh = url.searchParams.get("refresh") === "true";
      const entry = await readEntry<unknown[]>("db-import-candidates", candidateKey);

      // DB candidates are fetched under the selected target; passwords stripped.
      const fetchCandidates = async () => {
        const candidates = await withCfTarget(targetKey, (context) => detectAppDatabaseServicesInContext(context, appName));
        return candidates.map(({ password: _p, ...rest }) => { void _p; return rest; });
      };

      if (entry && !forceRefresh) {
        const refreshPromise = refreshCache({ namespace: "db-import-candidates", key: candidateKey, ttlMs: DEFAULT_CACHE_TTL.dbImportCandidates, resource: "db-import-candidates", fetcher: fetchCandidates });
        refreshPromise.catch(() => undefined);
        sendJson(res, { targetKey, target: targetCtx, appName, candidates: entry.data, cacheStatus: computeCacheStatus(entry), fromCache: true, isRefreshing: true, updatedAt: entry.updatedAt, updatedAgo: formatRelativeTime(entry.updatedAt) });
        return;
      }

      try {
        const candidates = await refreshCache({ namespace: "db-import-candidates", key: candidateKey, ttlMs: DEFAULT_CACHE_TTL.dbImportCandidates, resource: "db-import-candidates", fetcher: fetchCandidates });
        sendJson(res, { targetKey, target: targetCtx, appName, candidates, cacheStatus: "fresh", fromCache: false, isRefreshing: false, updatedAt: new Date().toISOString() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (entry) {
          sendJson(res, { targetKey, target: targetCtx, appName, candidates: entry.data, cacheStatus: "stale", fromCache: true, isRefreshing: false, updatedAt: entry.updatedAt, updatedAgo: formatRelativeTime(entry.updatedAt), warning: `Refresh failed; showing cached candidates. ${message}` });
        } else {
          sendJson(res, { targetKey, target: targetCtx, appName, candidates: [], cacheStatus: "missing", fromCache: false, isRefreshing: false, error: message });
        }
      }
      return;
    }

    if (pathname === "/api/btp/favorite" && method === "POST") {
      const body = await readJsonBody(req);
      const targetKey = getString(body, "targetKey");
      const add = body.add !== false;
      const parts = targetKey.split("::");
      const target: TCfTarget = { region: parts[0] ?? "", apiEndpoint: "", org: parts[1] ?? "", space: parts[2] ?? "" };
      if (add) await addFavoriteTarget(target); else await removeFavoriteTarget(target);
      sendJson(res, { ok: true });
      return;
    }

    if (pathname === "/api/btp/recent" && method === "POST") {
      const body = await readJsonBody(req);
      const targetKey = getString(body, "targetKey");
      const parts = targetKey.split("::");
      const target: TCfTarget = { region: parts[0] ?? "", apiEndpoint: "", org: parts[1] ?? "", space: parts[2] ?? "" };
      await addRecentTarget(target);
      sendJson(res, { ok: true });
      return;
    }

    // -------- Legacy BTP routes (current CF target) --------------------------

    if (pathname === "/api/btp/current-target" && method === "GET") {
      const session = await ensureCloudFoundrySession();
      const target = await getCloudFoundryTargetSummary();
      sendJson(res, {
        loggedIn: session.loggedIn,
        message: session.message,
        target,
        productionWarning: looksLikeProduction(target.org, target.space),
      });
      return;
    }

    if (pathname === "/api/btp/env" && method === "POST") {
      const body = await readJsonBody(req);
      const candidates = await detectAppDatabaseServices(getString(body, "app"));
      // Never expose passwords to the browser.
      const safeCandidates = candidates.map(({ password: _password, ...rest }) => {
        void _password;
        return rest;
      });
      sendJson(res, { services: safeCandidates });
      return;
    }

    // --- Catalog -------------------------------------------------------------
    // Read-only catalog/table routes run via runWithAdapter so a dropped socket
    // is reconnected and the read retried once. On failure they return a
    // structured error with recovery actions for the object explorer.
    if (pathname === "/api/catalog/schemas" && method === "GET") {
      const connectionId = url.searchParams.get("connectionId") ?? "";
      try {
        const schemas = await pool.runWithAdapter(connectionId, (adapter) => adapter.listSchemas(), { retryReadOnlyOnNetworkError: true });
        sendJson(res, { schemas });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/catalog/objects" && method === "GET") {
      const connectionId = url.searchParams.get("connectionId") ?? "";
      const kindsParam = url.searchParams.get("kinds");
      const kinds = kindsParam ? (kindsParam.split(",").filter(Boolean) as TDatabaseObjectKind[]) : undefined;
      try {
        const objects = await pool.runWithAdapter(connectionId, (adapter) => adapter.listObjects({
          schema: url.searchParams.get("schema") ?? undefined,
          search: url.searchParams.get("search") ?? undefined,
          kinds,
        }), { retryReadOnlyOnNetworkError: true });
        sendJson(res, { objects });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/catalog/columns" && method === "GET") {
      const connectionId = url.searchParams.get("connectionId") ?? "";
      const schema = url.searchParams.get("schema") ?? "";
      const table = url.searchParams.get("table") ?? "";
      try {
        const result = await pool.runWithAdapter(connectionId, async (adapter) => {
          const [columns, indexes] = await Promise.all([
            adapter.listColumns(schema, table),
            adapter.listIndexes(schema, table).catch(() => []),
          ]);
          return { columns, indexes };
        }, { retryReadOnlyOnNetworkError: true });
        sendJson(res, result);
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/catalog/ddl" && method === "GET") {
      const connectionId = url.searchParams.get("connectionId") ?? "";
      const schema = url.searchParams.get("schema") ?? "";
      const table = url.searchParams.get("table") ?? "";
      try {
        const ddl = await pool.runWithAdapter(connectionId, async (adapter) => {
          const columns = await adapter.listColumns(schema, table);
          return generateCreateTableDdl(adapter.type, schema, table, columns);
        }, { retryReadOnlyOnNetworkError: true });
        sendJson(res, { ddl });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/catalog/indexes" && method === "GET") {
      const connectionId = url.searchParams.get("connectionId") ?? "";
      try {
        const indexes = await pool.runWithAdapter(connectionId, (adapter) => adapter.listIndexes(url.searchParams.get("schema") ?? "", url.searchParams.get("table") ?? ""), { retryReadOnlyOnNetworkError: true });
        sendJson(res, { indexes });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/catalog/primary-key" && method === "GET") {
      const connectionId = url.searchParams.get("connectionId") ?? "";
      try {
        const primaryKey = await pool.runWithAdapter(connectionId, (adapter) => adapter.getPrimaryKey(url.searchParams.get("schema") ?? "", url.searchParams.get("table") ?? ""), { retryReadOnlyOnNetworkError: true });
        sendJson(res, { primaryKey });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/catalog/constraints" && method === "GET") {
      const connectionId = url.searchParams.get("connectionId") ?? "";
      const schema = url.searchParams.get("schema") ?? "";
      const table = url.searchParams.get("table") ?? "";
      try {
        const result = await pool.runWithAdapter(connectionId, async (adapter) => {
          const [primaryKey, indexes] = await Promise.all([
            adapter.getPrimaryKey(schema, table),
            adapter.listIndexes(schema, table).catch(() => []),
          ]);
          return { primaryKey, indexes };
        }, { retryReadOnlyOnNetworkError: true });
        sendJson(res, result);
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    // --- Table data ----------------------------------------------------------
    if (pathname === "/api/table/data" && method === "POST") {
      const body = await readJsonBody(req);
      const connectionId = getString(body, "connectionId");
      try {
        const result = await pool.runWithAdapter(connectionId, (adapter) => adapter.getTableData({
          schema: getString(body, "schema"),
          table: getString(body, "table"),
          limit: getNumber(body, "limit", 100),
          offset: getNumber(body, "offset", 0),
          where: getString(body, "where") || undefined,
          orderBy: getString(body, "orderBy") || undefined,
          orderDirection: getString(body, "orderDirection") === "desc" ? "desc" : "asc",
        }), { retryReadOnlyOnNetworkError: true });
        sendJson(res, { result });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/table/count" && method === "POST") {
      const body = await readJsonBody(req);
      const connectionId = getString(body, "connectionId");
      try {
        const count = await pool.runWithAdapter(connectionId, (adapter) => adapter.countRows(getString(body, "schema"), getString(body, "table")), { retryReadOnlyOnNetworkError: true });
        sendJson(res, { count });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if ((pathname === "/api/table/row/update" || pathname === "/api/table/row/insert" || pathname === "/api/table/row/delete") && method === "POST") {
      const body = await readJsonBody(req);
      const readOnly = body.readOnly === undefined ? serverReadOnlyDefault : Boolean(body.readOnly);

      if (readOnly) {
        sendJson(res, { ok: false, blocked: true, error: "Read-only mode is on. Turn it off to modify data." });
        return;
      }

      const connectionId = getString(body, "connectionId");
      const schema = getString(body, "schema");
      const table = getString(body, "table");

      try {
        const adapter = await pool.getAdapter(connectionId);
        let result;
        if (pathname.endsWith("/update")) {
          result = await updateRow(adapter, { schema, table, changes: getObject(body, "changes"), keys: getObject(body, "keys") });
        } else if (pathname.endsWith("/insert")) {
          result = await insertRow(adapter, { schema, table, values: getObject(body, "values") });
        } else {
          result = await deleteRow(adapter, { schema, table, keys: getObject(body, "keys") });
        }
        sendJson(res, { ok: true, result });
      } catch (error) {
        const built = buildAdapterError(connectionId, error);
        sendJson(res, { ok: false, ...built.payload }, built.status);
      }
      return;
    }

    if (pathname === "/api/table/save-changes" && method === "POST") {
      const body = await readJsonBody(req);
      const readOnly = body.readOnly === undefined ? serverReadOnlyDefault : Boolean(body.readOnly);

      if (readOnly) {
        sendJson(res, { ok: false, blocked: true, error: "Read-only mode is on. Turn it off to save changes." });
        return;
      }

      const connectionId = getString(body, "connectionId");
      try {
        const adapter = await pool.getAdapter(connectionId);
        const result = await saveTableChanges(adapter, {
          schema: getString(body, "schema"),
          table: getString(body, "table"),
          primaryKeyColumns: Array.isArray(body.primaryKeyColumns) ? (body.primaryKeyColumns as string[]) : [],
          updates: Array.isArray(body.updates) ? (body.updates as TTableChangeSet["updates"]) : [],
          inserts: Array.isArray(body.inserts) ? (body.inserts as TTableChangeSet["inserts"]) : [],
          deletes: Array.isArray(body.deletes) ? (body.deletes as TTableChangeSet["deletes"]) : [],
        });
        sendJson(res, { ok: true, result });
      } catch (error) {
        const built = buildAdapterError(connectionId, error);
        sendJson(res, { ok: false, ...built.payload }, built.status);
      }
      return;
    }

    if (pathname === "/api/table/sql" && method === "POST") {
      const body = await readJsonBody(req);
      const connectionId = getString(body, "connectionId");
      try {
        const adapter = await pool.getAdapter(connectionId);
        const schema = getString(body, "schema");
        const table = getString(body, "table");
        sendJson(res, {
          select: generateSelectSql(adapter.type, schema, table, getNumber(body, "limit", 100)),
          count: generateCountSql(adapter.type, schema, table),
        });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    // --- Query run -----------------------------------------------------------
    if (pathname === "/api/query/run" && method === "POST") {
      const body = await readJsonBody(req);
      const connectionId = getString(body, "connectionId");
      const sql = getString(body, "sql");
      const limit = getNumber(body, "limit", 0);
      const readOnly = body.readOnly === undefined ? serverReadOnlyDefault : Boolean(body.readOnly);
      const confirmDangerous = Boolean(body.confirmDangerous);

      if (!connectionId) {
        sendJson(res, { ok: false, error: "Select a connection first." });
        return;
      }

      const safety = analyzeSqlSafety(sql, { readOnly });

      if (safety.blockedByReadOnly) {
        sendJson(res, { ok: false, blocked: true, safety, error: `Read-only mode blocks: ${safety.matchedKeywords.join(", ")}` });
        return;
      }

      if (safety.isDestructive && !confirmDangerous) {
        sendJson(res, { ok: false, needsConfirmation: true, safety });
        return;
      }

      const connection = await getResolvedConnection(connectionId).catch(() => undefined);

      try {
        const adapter = await pool.getAdapter(connectionId);
        const effectiveSql = appendSafeLimit(adapter.type, sql, limit);
        const result = await adapter.runQuery(effectiveSql, { maxRows: limit > 0 ? limit : undefined });
        await appendQueryHistory({
          connectionId,
          connectionName: connection?.name,
          connectionType: adapter.type,
          sql,
          durationMs: result.durationMs,
          success: true,
          rowCount: result.rowCount,
        });
        sendJson(res, { ok: true, result, safety, effectiveSql });
      } catch (error) {
        const built = buildAdapterError(connectionId, error);
        await appendQueryHistory({
          connectionId,
          connectionName: connection?.name,
          connectionType: connection?.type,
          sql,
          durationMs: 0,
          success: false,
          error: built.payload.error,
        });
        sendJson(res, { ok: false, ...built.payload }, built.status);
      }
      return;
    }

    // --- Saved queries -------------------------------------------------------
    if (pathname === "/api/queries" && method === "GET") {
      sendJson(res, { queries: await listSavedQueries() });
      return;
    }

    if (pathname === "/api/queries" && method === "POST") {
      const body = await readJsonBody(req);
      const query = await saveQuery({
        name: getString(body, "name"),
        sql: getString(body, "sql"),
        connectionId: getString(body, "connectionId") || undefined,
        connectionType: (getString(body, "connectionType") || undefined) as TDatabaseType | undefined,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
      });
      sendJson(res, { query });
      return;
    }

    if (pathname.startsWith("/api/queries/") && method === "PUT") {
      const id = decodeURIComponent(pathname.slice("/api/queries/".length));
      const body = await readJsonBody(req);
      const name = getString(body, "name");
      const sql = getString(body, "sql");
      const query = sql
        ? await saveQuery({ id, name, sql, connectionId: getString(body, "connectionId") || undefined })
        : await renameSavedQuery(id, name);
      sendJson(res, { query });
      return;
    }

    if (pathname.startsWith("/api/queries/") && method === "DELETE") {
      const id = decodeURIComponent(pathname.slice("/api/queries/".length));
      sendJson(res, { deleted: await deleteSavedQuery(id) });
      return;
    }

    // --- Workspace + settings ------------------------------------------------
    if (pathname === "/api/studio/workspace" && method === "GET") {
      sendJson(res, { workspace: await readWorkspace() });
      return;
    }

    if (pathname === "/api/studio/workspace" && method === "PUT") {
      const body = await readJsonBody(req);
      const workspace = await writeWorkspace(body as unknown as TStudioWorkspaceState);
      sendJson(res, { workspace });
      return;
    }

    if (pathname === "/api/studio/settings" && method === "GET") {
      sendJson(res, { settings: await readStudioSettings() });
      return;
    }

    if (pathname === "/api/studio/settings" && method === "PUT") {
      const body = await readJsonBody(req);
      const settings = await writeStudioSettings(body);
      sendJson(res, { settings });
      return;
    }

    // --- SQL helpers ---------------------------------------------------------
    if (pathname === "/api/sql/format" && method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, { sql: formatSql(getString(body, "sql")) });
      return;
    }

    if (pathname === "/api/sql/parse-statements" && method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, { statements: splitStatements(getString(body, "sql")) });
      return;
    }

    if (pathname === "/api/sql/generate-table-query" && method === "POST") {
      const body = await readJsonBody(req);
      const connectionId = getString(body, "connectionId");
      try {
        const adapter = await pool.getAdapter(connectionId);
        const sql = generateTableQuery({
          type: adapter.type,
          schema: getString(body, "schema"),
          table: getString(body, "table"),
          where: getString(body, "where") || undefined,
          sort: Array.isArray(body.sort) ? (body.sort as TGridSortState[]) : undefined,
          limit: getNumber(body, "limit", 100),
          offset: getNumber(body, "offset", 0),
        });
        sendJson(res, { sql });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    if (pathname === "/api/table/generate-sql" && method === "POST") {
      const body = await readJsonBody(req);
      const connectionId = getString(body, "connectionId");
      try {
        const adapter = await pool.getAdapter(connectionId);
        const schema = getString(body, "schema");
        const table = getString(body, "table");
        const [columns, primaryKey] = await Promise.all([
          adapter.listColumns(schema, table).catch(() => []),
          adapter.getPrimaryKey(schema, table).catch(() => ({ columns: [] })),
        ]);
        sendJson(res, {
          select: generateSelectSql(adapter.type, schema, table, getNumber(body, "limit", 100)),
          count: generateCountSql(adapter.type, schema, table),
          insert: generateInsertTemplate(adapter.type, schema, table, columns),
          update: generateUpdateTemplate(adapter.type, schema, table, columns, primaryKey.columns),
        });
      } catch (error) {
        sendAdapterError(res, connectionId, error);
      }
      return;
    }

    // --- History -------------------------------------------------------------
    if (pathname === "/api/history" && method === "GET") {
      sendJson(res, { history: await listQueryHistory(100) });
      return;
    }

    if (pathname === "/api/history" && method === "DELETE") {
      const { clearQueryHistory } = await import("./db-query-history");
      await clearQueryHistory();
      sendJson(res, { cleared: true });
      return;
    }

    // --- Export --------------------------------------------------------------
    if (pathname === "/api/export/csv" && method === "POST") {
      const body = await readJsonBody(req);
      const fields = Array.isArray(body.fields) ? (body.fields as string[]) : [];
      const rows = Array.isArray(body.rows) ? (body.rows as Array<Record<string, unknown>>) : [];
      sendText(res, toCsv(fields, rows), "text/csv; charset=utf-8", "result.csv");
      return;
    }

    if (pathname === "/api/export/json" && method === "POST") {
      const body = await readJsonBody(req);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      sendText(res, JSON.stringify(rows, null, 2), "application/json; charset=utf-8", "result.json");
      return;
    }

    if (pathname === "/api/export/data" && method === "POST") {
      const body = await readJsonBody(req);
      const source = getString(body, "source");
      const format = getString(body, "format") === "json" ? "json" : "csv";
      const schema = getString(body, "schema");
      const table = getString(body, "objectName");
      const selectedColumns = Array.isArray(body.selectedColumns) ? (body.selectedColumns as string[]) : undefined;
      let rows: Array<Record<string, unknown>> = [];
      let fields: string[] = [];

      if (source === "selected-rows" && Array.isArray(body.selectedRows)) {
        rows = body.selectedRows as Array<Record<string, unknown>>;
        fields = selectedColumns ?? (rows[0] ? Object.keys(rows[0]) : []);
      } else {
        const adapter = await pool.getAdapter(getString(body, "connectionId"));
        const sort = Array.isArray(body.sort) ? (body.sort as TGridSortState[]) : [];
        const isPage = source === "current-page";
        const result = await adapter.getTableData({
          schema,
          table,
          limit: isPage ? getNumber(body, "limit", 100) : 100000,
          offset: isPage ? getNumber(body, "offset", 0) : 0,
          where: source === "whole-table" ? undefined : getString(body, "whereClause") || undefined,
          orderBy: sort[0]?.column,
          orderDirection: sort[0]?.direction === "desc" ? "desc" : "asc",
        });
        rows = result.rows;
        fields = selectedColumns ?? result.fields;
      }

      if (selectedColumns) {
        rows = rows.map((row) => {
          const picked: Record<string, unknown> = {};
          for (const column of selectedColumns) picked[column] = row[column];
          return picked;
        });
        fields = selectedColumns;
      }

      if (format === "json") {
        sendText(res, JSON.stringify(rows, null, 2), "application/json; charset=utf-8", `${table || "result"}.json`);
      } else {
        sendText(res, toCsv(fields, rows), "text/csv; charset=utf-8", `${table || "result"}.csv`);
      }
      return;
    }

    // Static assets + SPA client-side routes (anything else that's a GET, not under /api).
    if (method === "GET" && !pathname.startsWith("/api/") && !options.apiOnly) {
      await serveStudioAsset(pathname, res);
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Not found" }));
  };

  const server = http.createServer((req, res) => {
    router(req, res).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        sendJson(res, { error: message }, 500);
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const url = `http://127.0.0.1:${port}`;

  if (options.apiOnly) {
    reportStudioStartupLine(options.onLog, `SimpleMDG CF DB Studio API: ${url}`, chalk.green);
    reportStudioStartupLine(options.onLog, "Running in --api-only mode (no UI is served here).", chalk.gray);
    reportStudioStartupLine(options.onLog, "In another terminal, run:", chalk.gray);
    reportStudioStartupLine(options.onLog, "  cd studio && npm run dev", chalk.cyan);
    reportStudioStartupLine(options.onLog, `Vite will proxy /api/* to ${url}.`, chalk.gray);
  } else {
    reportStudioStartupLine(options.onLog, `SimpleMDG CF DB Studio: ${url}`, chalk.green);
  }

  if (serverReadOnlyDefault) {
    reportStudioStartupLine(options.onLog, "Read-only mode is ON. Write/DDL statements are blocked.", chalk.yellow);
  }
  reportStudioStartupLine(options.onLog, "Server is bound to 127.0.0.1 only. Press Ctrl+C to stop.", chalk.gray);

  if (!options.apiOnly && !process.env.SMDG_STUDIO_NO_OPEN) {
    await openBrowser(url);
  }

  return {
    url,
    port,
    close: async () => {
      await pool.closeAll();
      // See ai-studio-server.ts's close() for why closeAllConnections() is needed here:
      // the browser tab opened by openBrowser() holds a keep-alive socket that would
      // otherwise keep server.close()'s callback from ever firing.
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
