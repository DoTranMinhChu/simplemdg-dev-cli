import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import type { TDatabaseType, TSavedQuery } from "./db-types";

const QUERIES_DIRECTORY = path.join(os.homedir(), ".simplemdg", "db-queries");

export type TSaveQueryInput = {
  id?: string;
  name: string;
  sql: string;
  connectionType?: TDatabaseType;
  connectionId?: string;
  tags?: string[];
};

function queryFilePath(id: string): string {
  return path.join(QUERIES_DIRECTORY, `${id}.json`);
}

function sanitizeFileBaseName(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "query";
}

export async function listSavedQueries(): Promise<TSavedQuery[]> {
  if (!(await fs.pathExists(QUERIES_DIRECTORY))) {
    return [];
  }

  const entries = await fs.readdir(QUERIES_DIRECTORY);
  const queries: TSavedQuery[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) {
      continue;
    }

    const parsed = await fs.readJson(path.join(QUERIES_DIRECTORY, entry)).catch(() => undefined) as TSavedQuery | undefined;

    if (parsed?.id && typeof parsed.sql === "string") {
      queries.push(parsed);
    }
  }

  return queries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getSavedQuery(id: string): Promise<TSavedQuery | undefined> {
  const filePath = queryFilePath(id);

  if (!(await fs.pathExists(filePath))) {
    return undefined;
  }

  return await fs.readJson(filePath).catch(() => undefined) as TSavedQuery | undefined;
}

export async function saveQuery(input: TSaveQueryInput): Promise<TSavedQuery> {
  await fs.ensureDir(QUERIES_DIRECTORY);
  const now = new Date().toISOString();
  const existing = input.id ? await getSavedQuery(input.id) : undefined;

  const query: TSavedQuery = {
    id: existing?.id ?? input.id ?? crypto.randomUUID(),
    name: input.name.trim() || "Untitled query",
    sql: input.sql,
    connectionType: input.connectionType ?? existing?.connectionType,
    connectionId: input.connectionId ?? existing?.connectionId,
    tags: input.tags ?? existing?.tags ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await fs.writeJson(queryFilePath(query.id), query, { spaces: 2 });
  return query;
}

export async function renameSavedQuery(id: string, name: string): Promise<TSavedQuery> {
  const query = await getSavedQuery(id);

  if (!query) {
    throw new Error(`Saved query not found: ${id}`);
  }

  query.name = name.trim() || query.name;
  query.updatedAt = new Date().toISOString();
  await fs.writeJson(queryFilePath(id), query, { spaces: 2 });
  return query;
}

export async function deleteSavedQuery(id: string): Promise<boolean> {
  const filePath = queryFilePath(id);

  if (!(await fs.pathExists(filePath))) {
    return false;
  }

  await fs.remove(filePath);
  return true;
}

export async function exportSavedQueryToSql(id: string, targetDirectory: string): Promise<string> {
  const query = await getSavedQuery(id);

  if (!query) {
    throw new Error(`Saved query not found: ${id}`);
  }

  await fs.ensureDir(targetDirectory);
  const targetPath = path.join(targetDirectory, `${sanitizeFileBaseName(query.name)}.sql`);
  await fs.writeFile(targetPath, query.sql, "utf8");
  return targetPath;
}

export async function importSqlFile(filePath: string, options?: { name?: string; tags?: string[] }): Promise<TSavedQuery> {
  const resolvedPath = path.resolve(filePath);

  if (!(await fs.pathExists(resolvedPath))) {
    throw new Error(`SQL file not found: ${resolvedPath}`);
  }

  const sql = await fs.readFile(resolvedPath, "utf8");
  const name = options?.name?.trim() || path.basename(resolvedPath, path.extname(resolvedPath));
  return saveQuery({ name, sql, tags: options?.tags });
}

export function getQueriesDirectory(): string {
  return QUERIES_DIRECTORY;
}
