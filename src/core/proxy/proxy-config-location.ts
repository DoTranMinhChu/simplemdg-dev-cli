import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where `environments.json` lives — one flat file under `~/.simplemdg/proxy/`, the same
 * pattern every other feature in this CLI already uses for its own local data (DB
 * connections, BTP credentials, deploy targets). No profile/directory picker: `smdg` runs on
 * one person's machine, so there is exactly one place for this to live.
 */
const PROXY_DIR = path.join(os.homedir(), ".simplemdg", "proxy");
const PROXY_CONFIG_PATH = path.join(PROXY_DIR, "environments.json");

// Superseded "profiles" layout from an earlier round — the built-in default profile's
// directory. Migrated from automatically, once, so nobody's already-configured environments
// go missing when this file is read for the first time under the new scheme.
const LEGACY_DEFAULT_PROFILE_CONFIG_PATH = path.join(PROXY_DIR, "local", "smdg.proxy.json");

function migrateLegacyConfigIfNeeded(): void {
  if (existsSync(PROXY_CONFIG_PATH)) return;
  if (!existsSync(LEGACY_DEFAULT_PROFILE_CONFIG_PATH)) return;
  mkdirSync(PROXY_DIR, { recursive: true });
  copyFileSync(LEGACY_DEFAULT_PROFILE_CONFIG_PATH, PROXY_CONFIG_PATH);
}

// Set once per `smdg proxy studio` process (at startup via `--config-dir`) — takes priority
// over the default location for THIS process only. A power-user/testing escape hatch, not
// something surfaced as a switchable "profile" in the UI.
let studioSessionDir: string | undefined;

export function setStudioSessionConfigDir(dir: string | undefined): void {
  studioSessionDir = dir ? path.resolve(dir) : undefined;
}

export function getStudioSessionConfigDir(): string | undefined {
  return studioSessionDir;
}

export const PROXY_CONFIG_FILE_NAME = "environments.json";

/** Resolves the on-disk path for the proxy environments file: explicit `--config-dir` flag >
 * Studio session override > the one fixed local location (auto-migrating legacy data the
 * first time it's read). */
export function resolveProxyConfigPath(explicitDir?: string): string {
  if (explicitDir) {
    return path.join(path.resolve(explicitDir), PROXY_CONFIG_FILE_NAME);
  }

  if (studioSessionDir) {
    return path.join(studioSessionDir, PROXY_CONFIG_FILE_NAME);
  }

  migrateLegacyConfigIfNeeded();
  return PROXY_CONFIG_PATH;
}
