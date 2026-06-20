import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { TNamespaceStat, TSmartCacheEntry } from "./smart-cache.types";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg", "cache");

type TNamespaceFile = Record<string, TSmartCacheEntry<unknown>>;

function namespaceFilePath(namespace: string): string {
  return path.join(CACHE_DIRECTORY, `${namespace}.json`);
}

export function getCacheDirectory(): string {
  return CACHE_DIRECTORY;
}

async function readNamespaceFile(namespace: string): Promise<TNamespaceFile> {
  const filePath = namespaceFilePath(namespace);

  if (!(await fs.pathExists(filePath))) {
    return {};
  }

  const parsed = await fs.readJson(filePath).catch(() => ({})) as TNamespaceFile;
  return parsed && typeof parsed === "object" ? parsed : {};
}

async function writeNamespaceFile(namespace: string, file: TNamespaceFile): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  await fs.writeJson(namespaceFilePath(namespace), file, { spaces: 2 });
}

export async function readEntry<TData>(namespace: string, key: string): Promise<TSmartCacheEntry<TData> | undefined> {
  const file = await readNamespaceFile(namespace);
  return file[key] as TSmartCacheEntry<TData> | undefined;
}

export async function readAllEntries<TData>(namespace: string): Promise<Record<string, TSmartCacheEntry<TData>>> {
  return await readNamespaceFile(namespace) as Record<string, TSmartCacheEntry<TData>>;
}

export async function writeEntry<TData>(namespace: string, key: string, entry: TSmartCacheEntry<TData>): Promise<void> {
  const file = await readNamespaceFile(namespace);
  file[key] = entry as TSmartCacheEntry<unknown>;
  await writeNamespaceFile(namespace, file);
}

export async function removeEntry(namespace: string, key: string): Promise<boolean> {
  const file = await readNamespaceFile(namespace);

  if (!(key in file)) {
    return false;
  }

  delete file[key];
  await writeNamespaceFile(namespace, file);
  return true;
}

export async function clearNamespace(namespace: string): Promise<void> {
  await fs.remove(namespaceFilePath(namespace)).catch(() => undefined);
}

export async function statNamespace(namespace: string): Promise<TNamespaceStat> {
  const filePath = namespaceFilePath(namespace);

  if (!(await fs.pathExists(filePath))) {
    return { namespace, count: 0, exists: false };
  }

  const file = await readNamespaceFile(namespace);
  const entries = Object.values(file);
  let lastUpdatedAt: string | undefined;

  for (const entry of entries) {
    if (!lastUpdatedAt || entry.updatedAt > lastUpdatedAt) {
      lastUpdatedAt = entry.updatedAt;
    }
  }

  return { namespace, count: entries.length, lastUpdatedAt, exists: true };
}
