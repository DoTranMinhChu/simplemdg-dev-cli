import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import { decryptSecret, encryptSecret } from "./db-crypto";
import type {
  TDatabaseConnectionProfile,
  TDatabaseType,
  TPublicDatabaseConnection,
  TResolvedDatabaseConnection,
} from "./db-types";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const CONNECTIONS_FILE_PATH = path.join(CACHE_DIRECTORY, "db-connections.json");

type TConnectionsCacheFile = {
  connections: TDatabaseConnectionProfile[];
};

/**
 * Draft used when creating or updating a connection. The password is provided
 * in plain text and encrypted before it ever touches disk.
 */
export type TConnectionDraft = {
  id?: string;
  name: string;
  color?: string;
  environment?: TDatabaseConnectionProfile["environment"];
  isFavorite?: boolean;
  type: TDatabaseType;
  region?: string;
  org?: string;
  space?: string;
  app?: string;
  serviceName?: string;
  servicePlan?: string;
  host: string;
  port: number;
  database?: string;
  schema?: string;
  username: string;
  password: string;
  ssl?: boolean;
  sslValidateCertificate?: boolean;
  tags?: string[];
};

async function readCacheFile(): Promise<TConnectionsCacheFile> {
  if (!(await fs.pathExists(CONNECTIONS_FILE_PATH))) {
    return { connections: [] };
  }

  const parsed = await fs
    .readJson(CONNECTIONS_FILE_PATH)
    .catch(() => ({ connections: [] })) as Partial<TConnectionsCacheFile>;

  return { connections: Array.isArray(parsed.connections) ? parsed.connections : [] };
}

async function writeCacheFile(cache: TConnectionsCacheFile): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  // Defensive: ensure every password is encrypted before persisting.
  const secured: TConnectionsCacheFile = {
    connections: cache.connections.map((connection) => ({
      ...connection,
      encryptedPassword: encryptSecret(connection.encryptedPassword),
    })),
  };
  await fs.writeJson(CONNECTIONS_FILE_PATH, secured, { spaces: 2 });
}

function toPublicConnection(profile: TDatabaseConnectionProfile): TPublicDatabaseConnection {
  const { encryptedPassword: _ignored, ...rest } = profile;
  void _ignored;
  return rest;
}

export async function listConnectionProfiles(): Promise<TDatabaseConnectionProfile[]> {
  const cache = await readCacheFile();
  return cache.connections;
}

export async function listPublicConnections(): Promise<TPublicDatabaseConnection[]> {
  const cache = await readCacheFile();
  return cache.connections
    .map(toPublicConnection)
    .sort((left, right) => (right.lastUsedAt ?? right.updatedAt).localeCompare(left.lastUsedAt ?? left.updatedAt));
}

export async function findConnectionProfile(id: string): Promise<TDatabaseConnectionProfile | undefined> {
  const cache = await readCacheFile();
  return cache.connections.find((connection) => connection.id === id);
}

export async function getResolvedConnection(id: string): Promise<TResolvedDatabaseConnection> {
  const profile = await findConnectionProfile(id);

  if (!profile) {
    throw new Error(`Connection not found: ${id}`);
  }

  const { encryptedPassword, ...rest } = profile;
  return { ...rest, password: decryptSecret(encryptedPassword) };
}

export async function upsertConnectionFromDraft(draft: TConnectionDraft): Promise<TDatabaseConnectionProfile> {
  const cache = await readCacheFile();
  const now = new Date().toISOString();

  const existingIndex = draft.id
    ? cache.connections.findIndex((connection) => connection.id === draft.id)
    : cache.connections.findIndex((connection) =>
        connection.app === draft.app &&
        connection.serviceName === draft.serviceName &&
        connection.type === draft.type &&
        Boolean(draft.app) &&
        Boolean(draft.serviceName));

  const existing = existingIndex >= 0 ? cache.connections[existingIndex] : undefined;

  const profile: TDatabaseConnectionProfile = {
    id: existing?.id ?? draft.id ?? crypto.randomUUID(),
    name: draft.name,
    color: draft.color ?? existing?.color,
    environment: draft.environment ?? existing?.environment,
    isFavorite: draft.isFavorite ?? existing?.isFavorite,
    type: draft.type,
    region: draft.region,
    org: draft.org,
    space: draft.space,
    app: draft.app,
    serviceName: draft.serviceName,
    servicePlan: draft.servicePlan,
    host: draft.host,
    port: draft.port,
    database: draft.database,
    schema: draft.schema,
    username: draft.username,
    encryptedPassword: encryptSecret(draft.password),
    ssl: draft.ssl,
    sslValidateCertificate: draft.sslValidateCertificate,
    tags: draft.tags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastUsedAt: existing?.lastUsedAt,
  };

  if (existingIndex >= 0) {
    cache.connections[existingIndex] = profile;
  } else {
    cache.connections.unshift(profile);
  }

  await writeCacheFile(cache);
  return profile;
}

export type TConnectionFieldPatch = Partial<Pick<TDatabaseConnectionProfile, "name" | "color" | "environment" | "isFavorite" | "tags">>;

export async function updateConnectionFields(id: string, patch: TConnectionFieldPatch): Promise<TDatabaseConnectionProfile> {
  const cache = await readCacheFile();
  const profile = cache.connections.find((connection) => connection.id === id);

  if (!profile) {
    throw new Error(`Connection not found: ${id}`);
  }

  if (patch.name !== undefined) profile.name = patch.name;
  if (patch.color !== undefined) profile.color = patch.color;
  if (patch.environment !== undefined) profile.environment = patch.environment;
  if (patch.isFavorite !== undefined) profile.isFavorite = patch.isFavorite;
  if (patch.tags !== undefined) profile.tags = patch.tags;
  profile.updatedAt = new Date().toISOString();

  await writeCacheFile(cache);
  return profile;
}

export async function removeConnection(id: string): Promise<boolean> {
  const cache = await readCacheFile();
  const nextConnections = cache.connections.filter((connection) => connection.id !== id);

  if (nextConnections.length === cache.connections.length) {
    return false;
  }

  await writeCacheFile({ connections: nextConnections });
  return true;
}

export async function renameConnection(id: string, name: string): Promise<TDatabaseConnectionProfile> {
  const cache = await readCacheFile();
  const profile = cache.connections.find((connection) => connection.id === id);

  if (!profile) {
    throw new Error(`Connection not found: ${id}`);
  }

  profile.name = name;
  profile.updatedAt = new Date().toISOString();
  await writeCacheFile(cache);
  return profile;
}

export async function duplicateConnection(id: string): Promise<TDatabaseConnectionProfile> {
  const cache = await readCacheFile();
  const source = cache.connections.find((connection) => connection.id === id);

  if (!source) {
    throw new Error(`Connection not found: ${id}`);
  }

  const now = new Date().toISOString();
  const copy: TDatabaseConnectionProfile = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: undefined,
  };

  cache.connections.unshift(copy);
  await writeCacheFile(cache);
  return copy;
}

export async function touchConnectionUsage(id: string): Promise<void> {
  const cache = await readCacheFile();
  const profile = cache.connections.find((connection) => connection.id === id);

  if (!profile) {
    return;
  }

  profile.lastUsedAt = new Date().toISOString();
  await writeCacheFile(cache);
}

export function getConnectionsFilePath(): string {
  return CONNECTIONS_FILE_PATH;
}
