import os from "node:os";
import path from "node:path";
import fs from "fs-extra";

const HISTORY_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const HISTORY_FILE_PATH = path.join(HISTORY_DIRECTORY, "history.json");
const MAX_HISTORY_ENTRIES = 200;

// Flag names that must never be persisted, even redacted-in-part — see spec
// §22 ("Do not store: password, token, secret, raw credential").
const SECRET_LIKE_PATTERN = /password|token|secret|credential|apikey|api-key/i;

export type TCommandHistoryEntry = {
  id: string;
  path: string[];
  args: string[];
  project?: string;
  timestamp: string;
  durationMs: number;
  success: boolean;
};

export type TCommandHistoryFile = {
  entries: TCommandHistoryEntry[];
  favorites: string[];
};

const EMPTY_HISTORY: TCommandHistoryFile = { entries: [], favorites: [] };

/** Drops the value half of any `--flag value` / `--flag=value` pair whose flag name looks credential-shaped. */
export function redactArgs(args: string[]): string[] {
  const redacted: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equalsMatch = arg.match(/^(--[\w-]+)=(.*)$/);

    if (equalsMatch && SECRET_LIKE_PATTERN.test(equalsMatch[1])) {
      redacted.push(`${equalsMatch[1]}=[redacted]`);
      continue;
    }

    redacted.push(arg);

    if (arg.startsWith("--") && SECRET_LIKE_PATTERN.test(arg)) {
      const next = args[index + 1];
      if (next !== undefined && !next.startsWith("--")) {
        redacted.push("[redacted]");
        index += 1;
      }
    }
  }

  return redacted;
}

export async function readCommandHistory(): Promise<TCommandHistoryFile> {
  if (!(await fs.pathExists(HISTORY_FILE_PATH))) {
    return { ...EMPTY_HISTORY };
  }

  const file = await fs.readJson(HISTORY_FILE_PATH).catch(() => EMPTY_HISTORY) as Partial<TCommandHistoryFile>;

  return {
    entries: file.entries ?? [],
    favorites: file.favorites ?? [],
  };
}

async function writeCommandHistory(file: TCommandHistoryFile): Promise<void> {
  await fs.ensureDir(HISTORY_DIRECTORY);
  await fs.writeJson(HISTORY_FILE_PATH, file, { spaces: 2 });
}

export async function recordCommandExecution(entry: Omit<TCommandHistoryEntry, "args"> & { args?: string[] }): Promise<void> {
  const file = await readCommandHistory();
  const nextEntry: TCommandHistoryEntry = { ...entry, args: redactArgs(entry.args ?? []) };
  file.entries = [nextEntry, ...file.entries].slice(0, MAX_HISTORY_ENTRIES);
  await writeCommandHistory(file);
}

export async function getRecentCommands(limit = 10): Promise<TCommandHistoryEntry[]> {
  const file = await readCommandHistory();
  return file.entries.slice(0, limit);
}

export async function toggleFavoriteCommand(id: string): Promise<string[]> {
  const file = await readCommandHistory();
  file.favorites = file.favorites.includes(id)
    ? file.favorites.filter((favoriteId) => favoriteId !== id)
    : [...file.favorites, id];
  await writeCommandHistory(file);
  return file.favorites;
}

export async function getFavoriteCommandIds(): Promise<string[]> {
  const file = await readCommandHistory();
  return file.favorites;
}
