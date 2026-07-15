import path from "node:path";
import fs from "fs-extra";
import { findNearestRepository } from "../repository";
import { getDirname } from "../esm-paths";
import type { TPluginKind, TPluginManifest } from "./plugin-types";

const PLUGINS_DIRNAME = "plugins";
const MANIFEST_FILENAME = "plugin.json";
const DEFAULT_USAGE_FILENAME = "USAGE.md";
const PLUGIN_KINDS: TPluginKind[] = ["agent", "skill", "mcp-bundle"];

const __dirname = getDirname(import.meta.url);

/** Resolves the directory that holds the bundled `plugins/<id>/plugin.json` catalog — the CLI's
 * own installation root, found the same way `ai-studio-server.ts` locates its studio dist dir. */
export async function resolvePluginsRoot(): Promise<string> {
  const repository = await findNearestRepository(__dirname);
  if (!repository) {
    throw new Error("Could not locate the simplemdg-dev-cli installation root to read the bundled plugin registry.");
  }
  return path.join(repository.repositoryPath, PLUGINS_DIRNAME);
}

export async function getPluginDir(pluginId: string): Promise<string> {
  const root = await resolvePluginsRoot();
  return path.join(root, pluginId);
}

function requireString(raw: Record<string, unknown>, field: string, context: string): string {
  const value = raw[field];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid plugin manifest (${context}): "${field}" must be a non-empty string.`);
  }
  return value;
}

function optionalStringArray(raw: Record<string, unknown>, field: string, context: string): string[] | undefined {
  const value = raw[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Invalid plugin manifest (${context}): "${field}" must be an array of strings.`);
  }
  return value as string[];
}

function validateManifest(context: string, raw: unknown): TPluginManifest {
  if (!raw || typeof raw !== "object") {
    throw new Error(`Invalid plugin manifest (${context}): expected a JSON object.`);
  }
  const record = raw as Record<string, unknown>;

  const id = requireString(record, "id", context);
  const version = requireString(record, "version", context);
  const displayName = requireString(record, "displayName", context);
  const description = requireString(record, "description", context);
  const kind = requireString(record, "kind", context) as TPluginKind;

  if (!PLUGIN_KINDS.includes(kind)) {
    throw new Error(`Invalid plugin manifest (${context}): "kind" must be one of ${PLUGIN_KINDS.join(", ")}.`);
  }

  const dependsOn = optionalStringArray(record, "dependsOn", context) ?? [];
  const renamedFrom = optionalStringArray(record, "renamedFrom", context);

  const mcpScopeRaw = record.mcpScope;
  if (mcpScopeRaw !== undefined && mcpScopeRaw !== "always-user") {
    throw new Error(`Invalid plugin manifest (${context}): "mcpScope" must be "always-user" when present.`);
  }

  const componentsRaw = record.components;
  if (!componentsRaw || typeof componentsRaw !== "object") {
    throw new Error(`Invalid plugin manifest (${context}): "components" must be an object.`);
  }
  const componentsRecord = componentsRaw as Record<string, unknown>;
  const agentFiles = optionalStringArray(componentsRecord, "agentFiles", context);
  const skillDirRaw = componentsRecord.skillDir;
  if (skillDirRaw !== undefined && typeof skillDirRaw !== "string") {
    throw new Error(`Invalid plugin manifest (${context}): "components.skillDir" must be a string.`);
  }
  const mcpServersRaw = componentsRecord.mcpServers;
  let mcpServers: TPluginManifest["components"]["mcpServers"];
  if (mcpServersRaw !== undefined) {
    if (!Array.isArray(mcpServersRaw)) {
      throw new Error(`Invalid plugin manifest (${context}): "components.mcpServers" must be an array.`);
    }
    mcpServers = mcpServersRaw.map((entry, index) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(`Invalid plugin manifest (${context}): "components.mcpServers[${index}]" must be an object.`);
      }
      const entryRecord = entry as Record<string, unknown>;
      return {
        name: requireString(entryRecord, "name", `${context} mcpServers[${index}]`),
        package: requireString(entryRecord, "package", `${context} mcpServers[${index}]`),
        args: optionalStringArray(entryRecord, "args", `${context} mcpServers[${index}]`) ?? [],
      };
    });
  }

  const studioExtensionRaw = record.studioExtension;
  let studioExtension: TPluginManifest["studioExtension"];
  if (studioExtensionRaw !== undefined) {
    if (!studioExtensionRaw || typeof studioExtensionRaw !== "object") {
      throw new Error(`Invalid plugin manifest (${context}): "studioExtension" must be an object.`);
    }
    const extensionRecord = studioExtensionRaw as Record<string, unknown>;
    const filesRaw = extensionRecord.files;
    if (!Array.isArray(filesRaw)) {
      throw new Error(`Invalid plugin manifest (${context}): "studioExtension.files" must be an array.`);
    }
    studioExtension = {
      id: requireString(extensionRecord, "id", `${context} studioExtension`),
      label: requireString(extensionRecord, "label", `${context} studioExtension`),
      instanceGlob: requireString(extensionRecord, "instanceGlob", `${context} studioExtension`),
      instanceLabel: requireString(extensionRecord, "instanceLabel", `${context} studioExtension`),
      files: filesRaw.map((entry, index) => {
        const entryRecord = entry as Record<string, unknown>;
        const render = requireString(entryRecord, "render", `${context} studioExtension.files[${index}]`);
        if (render !== "markdown" && render !== "text" && render !== "image-gallery") {
          throw new Error(`Invalid plugin manifest (${context}): "studioExtension.files[${index}].render" must be "markdown", "text", or "image-gallery".`);
        }
        return {
          match: requireString(entryRecord, "match", `${context} studioExtension.files[${index}]`),
          render,
        };
      }),
    };
  }

  const usageFileRaw = record.usageFile;
  if (usageFileRaw !== undefined && typeof usageFileRaw !== "string") {
    throw new Error(`Invalid plugin manifest (${context}): "usageFile" must be a string.`);
  }

  return {
    id,
    version,
    displayName,
    description,
    kind,
    dependsOn,
    renamedFrom,
    mcpScope: mcpScopeRaw as "always-user" | undefined,
    components: { agentFiles, skillDir: skillDirRaw, mcpServers },
    studioExtension,
    usageFile: usageFileRaw as string | undefined,
  };
}

export async function loadPluginRegistry(): Promise<Map<string, TPluginManifest>> {
  const root = await resolvePluginsRoot();
  const registry = new Map<string, TPluginManifest>();

  if (!(await fs.pathExists(root))) {
    return registry;
  }

  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginDir = path.join(root, entry.name);
    const manifestPath = path.join(pluginDir, MANIFEST_FILENAME);
    if (!(await fs.pathExists(manifestPath))) continue;

    const raw = await fs.readJson(manifestPath);
    const manifest = validateManifest(manifestPath, raw);

    if (manifest.id !== entry.name) {
      throw new Error(`Plugin id "${manifest.id}" must match its folder name "${entry.name}" (${manifestPath}).`);
    }
    if (registry.has(manifest.id)) {
      throw new Error(`Duplicate plugin id "${manifest.id}" found while loading the registry.`);
    }

    registry.set(manifest.id, manifest);
  }

  return registry;
}

export async function getPluginUsage(pluginId: string): Promise<string | undefined> {
  const registry = await loadPluginRegistry();
  const manifest = registry.get(pluginId);
  if (!manifest) return undefined;

  const pluginDir = await getPluginDir(pluginId);
  const usagePath = path.join(pluginDir, manifest.usageFile ?? DEFAULT_USAGE_FILENAME);
  if (!(await fs.pathExists(usagePath))) return undefined;
  return fs.readFile(usagePath, "utf8");
}
