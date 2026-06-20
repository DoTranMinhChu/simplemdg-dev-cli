import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { TStudioSettings } from "../db-types";

const SETTINGS_PATH = path.join(os.homedir(), ".simplemdg", "db-studio-settings.json");

export const DEFAULT_SETTINGS: TStudioSettings = {
  restoreWorkspace: true,
  defaultRowLimit: 100,
  defaultSchema: undefined,
  readOnlyByDefault: false,
  queryTimeoutMs: 30000,
  autoFormatGeneratedSql: true,
  autoSaveDelayMs: 500,
  maxHistoryItems: 300,
  showProductionWarning: true,
  theme: "dark",
};

export async function readStudioSettings(): Promise<TStudioSettings> {
  if (!(await fs.pathExists(SETTINGS_PATH))) {
    return { ...DEFAULT_SETTINGS };
  }

  const parsed = await fs.readJson(SETTINGS_PATH).catch(() => ({})) as Partial<TStudioSettings>;
  return { ...DEFAULT_SETTINGS, ...parsed };
}

export async function writeStudioSettings(patch: Partial<TStudioSettings>): Promise<TStudioSettings> {
  const current = await readStudioSettings();
  const next: TStudioSettings = { ...current, ...patch };
  await fs.ensureDir(path.dirname(SETTINGS_PATH));
  await fs.writeJson(SETTINGS_PATH, next, { spaces: 2 });
  return next;
}
