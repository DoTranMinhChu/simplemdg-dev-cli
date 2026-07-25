import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { getResolvedConnection } from "../db/db-cache";
import type { StudioConnectionPool } from "../db/db-connection";
import type { TDatabaseObject } from "../db/db-types";
import { AUDIT_LOG_CATALOG } from "./audit-log-catalog";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const TABLE_MAP_FILE_PATH = path.join(CACHE_DIRECTORY, "audit-log-table-map.json");

export type TResolvedAuditLogTable = { schema: string; name: string; kind: string };
export type TAuditLogResolutionEntry = { catalogId: string; tables: TResolvedAuditLogTable[] };

export type TAuditLogEnvironmentResolution = {
  connectionId: string;
  schema?: string;
  resolvedAt: string;
  entries: TAuditLogResolutionEntry[];
  error?: string;
};

type TTableMapCacheFile = Record<string, TAuditLogEnvironmentResolution>;

async function readCacheFile(): Promise<TTableMapCacheFile> {
  if (!(await fs.pathExists(TABLE_MAP_FILE_PATH))) return {};
  return (await fs.readJson(TABLE_MAP_FILE_PATH).catch(() => ({}))) as TTableMapCacheFile;
}

async function writeCacheFile(cache: TTableMapCacheFile): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  await fs.writeJson(TABLE_MAP_FILE_PATH, cache, { spaces: 2 });
}

export async function getCachedResolution(connectionId: string): Promise<TAuditLogEnvironmentResolution | undefined> {
  const cache = await readCacheFile();
  return cache[connectionId];
}

/**
 * A plain `includes` substring match false-positives badly on CAP's real naming: e.g. candidate
 * "AUDITLOG" (for the generic `AuditLog` entity) also matches `...PROJECTAUDITLOG` (a completely
 * different entity, `ProjectAuditLog`) since "PROJECTAUDITLOG" contains "AUDITLOG" as a substring.
 * Require the candidate to be a whole trailing segment — the table name must END with the
 * candidate AND the character immediately before it (if any) must be a namespace/word separator
 * (`_` or `.`), not just any letter. This still matches regardless of schema/namespace prefix
 * (`CORE_PROCESS_BUSINESS_AUDITLOG`, `bp.model.f4.MDConsolidateLog`, ...) while rejecting
 * accidental substring collisions between unrelated entities that happen to share a suffix.
 */
function matchesTableNameCandidate(tableName: string, candidateUpper: string): boolean {
  const nameUpper = tableName.toUpperCase();
  if (!nameUpper.endsWith(candidateUpper)) return false;
  if (nameUpper.length === candidateUpper.length) return true;
  const boundaryChar = nameUpper[nameUpper.length - candidateUpper.length - 1];
  return boundaryChar === "_" || boundaryChar === ".";
}

/**
 * Probe an environment's schema ONCE (list every table/view/calc-view in one round trip via
 * `adapter.listObjects`), then match locally against every catalog entry's `tableNameCandidates`
 * (case-insensitive substring) — far cheaper than one search query per catalog entry, and works
 * uniformly for both single-table "core" entries and `multiTable` master-data-domain entries
 * (which may legitimately match several physical tables at once).
 *
 * Cached to disk until a caller explicitly passes `force: true` — the schema doesn't change
 * between deploys, so there's no reason to re-probe on every page load. A failed probe (dead
 * connection, permission error) is deliberately NOT cached, so the next call retries instead of
 * getting stuck showing "0 tables found" forever.
 */
export async function resolveEnvironmentTables(
  connectionId: string,
  pool: StudioConnectionPool,
  options?: { force?: boolean },
): Promise<TAuditLogEnvironmentResolution> {
  if (!options?.force) {
    const cached = await getCachedResolution(connectionId);
    if (cached) return cached;
  }

  const resolvedConnection = await getResolvedConnection(connectionId);

  try {
    const objects: TDatabaseObject[] = await pool.runWithAdapter(
      connectionId,
      (adapter) => adapter.listObjects({ schema: resolvedConnection.schema }),
      { retryReadOnlyOnNetworkError: true },
    );

    const entries: TAuditLogResolutionEntry[] = AUDIT_LOG_CATALOG.map((definition) => {
      const candidates = definition.tableNameCandidates.map((candidate) => candidate.toUpperCase());
      const tables = objects
        .filter((object) => candidates.some((candidate) => matchesTableNameCandidate(object.name, candidate)))
        .map((object) => ({ schema: object.schema, name: object.name, kind: object.kind }));
      return { catalogId: definition.id, tables };
    });

    const resolution: TAuditLogEnvironmentResolution = {
      connectionId,
      schema: resolvedConnection.schema,
      resolvedAt: new Date().toISOString(),
      entries,
    };

    const cache = await readCacheFile();
    cache[connectionId] = resolution;
    await writeCacheFile(cache);

    return resolution;
  } catch (error) {
    return {
      connectionId,
      schema: resolvedConnection.schema,
      resolvedAt: new Date().toISOString(),
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function removeResolution(connectionId: string): Promise<void> {
  const cache = await readCacheFile();
  if (cache[connectionId]) {
    delete cache[connectionId];
    await writeCacheFile(cache);
  }
}
