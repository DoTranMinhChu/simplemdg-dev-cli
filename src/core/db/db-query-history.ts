import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import fs from "fs-extra";
import type { TQueryHistoryItem } from "./db-types";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const HISTORY_FILE_PATH = path.join(CACHE_DIRECTORY, "db-query-history.json");
const MAX_HISTORY_ITEMS = 300;

type THistoryFile = {
  items: TQueryHistoryItem[];
};

async function readHistoryFile(): Promise<THistoryFile> {
  if (!(await fs.pathExists(HISTORY_FILE_PATH))) {
    return { items: [] };
  }

  const parsed = await fs.readJson(HISTORY_FILE_PATH).catch(() => ({ items: [] })) as Partial<THistoryFile>;
  return { items: Array.isArray(parsed.items) ? parsed.items : [] };
}

async function writeHistoryFile(file: THistoryFile): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  await fs.writeJson(HISTORY_FILE_PATH, file, { spaces: 2 });
}

export async function appendQueryHistory(item: Omit<TQueryHistoryItem, "id" | "timestamp">): Promise<TQueryHistoryItem> {
  const file = await readHistoryFile();
  const entry: TQueryHistoryItem = {
    ...item,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  file.items = [entry, ...file.items].slice(0, MAX_HISTORY_ITEMS);
  await writeHistoryFile(file);
  return entry;
}

export async function listQueryHistory(limit = 100): Promise<TQueryHistoryItem[]> {
  const file = await readHistoryFile();
  return file.items.slice(0, limit);
}

export async function clearQueryHistory(): Promise<void> {
  await writeHistoryFile({ items: [] });
}

export function getHistoryFilePath(): string {
  return HISTORY_FILE_PATH;
}
