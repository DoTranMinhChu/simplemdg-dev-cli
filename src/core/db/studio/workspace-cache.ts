import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type { TStudioWorkspaceState } from "../db-types";

const WORKSPACE_PATH = path.join(os.homedir(), ".simplemdg", "db-studio-workspace.json");
const WORKSPACE_VERSION = 1;

const EMPTY_WORKSPACE: TStudioWorkspaceState = {
  version: WORKSPACE_VERSION,
  activeTabId: undefined,
  tabs: [],
  tabGroups: [],
  layout: {},
  updatedAt: new Date(0).toISOString(),
};

export async function readWorkspace(): Promise<TStudioWorkspaceState> {
  if (!(await fs.pathExists(WORKSPACE_PATH))) {
    return { ...EMPTY_WORKSPACE };
  }

  const parsed = await fs.readJson(WORKSPACE_PATH).catch(() => undefined) as Partial<TStudioWorkspaceState> | undefined;

  if (!parsed || !Array.isArray(parsed.tabs)) {
    return { ...EMPTY_WORKSPACE };
  }

  return {
    version: WORKSPACE_VERSION,
    activeTabId: parsed.activeTabId,
    tabs: parsed.tabs,
    tabGroups: Array.isArray(parsed.tabGroups) ? parsed.tabGroups : [],
    layout: parsed.layout ?? {},
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
  };
}

export async function writeWorkspace(state: TStudioWorkspaceState): Promise<TStudioWorkspaceState> {
  const next: TStudioWorkspaceState = {
    version: WORKSPACE_VERSION,
    activeTabId: state.activeTabId,
    tabs: Array.isArray(state.tabs) ? state.tabs : [],
    tabGroups: Array.isArray(state.tabGroups) ? state.tabGroups : [],
    layout: state.layout ?? {},
    updatedAt: new Date().toISOString(),
  };
  await fs.ensureDir(path.dirname(WORKSPACE_PATH));
  await fs.writeJson(WORKSPACE_PATH, next, { spaces: 2 });
  return next;
}
