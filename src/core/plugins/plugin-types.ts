export type TInstallScope = "user" | "project";

export type TPluginKind = "agent" | "skill" | "mcp-bundle";

/** One MCP server this plugin registers. The stdio branch (default, backward-compatible with
 * every existing manifest) is spawned via `npx -y <package> <args...>`. The http branch registers
 * a remote MCP server by URL instead (e.g. an OAuth-authenticated hosted server) — no local process
 * spawned, no package/args. */
export type TMcpServerSpec =
  | { name: string; package: string; args: string[]; transport?: "stdio" }
  | { name: string; transport: "http"; url: string };

export type TStudioExtensionFileRule = {
  /** Glob relative to an instance directory, e.g. "screenshots/*.{png,jpg,jpeg}". */
  match: string;
  render: "markdown" | "text" | "image-gallery";
};

/** Declares an optional AI Studio panel for plugins that produce their own runtime artifacts. */
export type TStudioExtension = {
  id: string;
  label: string;
  /** Glob relative to a project root identifying one artifact "instance" per match, e.g. ".claude/evidence/*". */
  instanceGlob: string;
  /** Template for the instance's display name; "{basename}" is replaced with the matched directory's name. */
  instanceLabel: string;
  files: TStudioExtensionFileRule[];
};

export type TPluginManifest = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  kind: TPluginKind;
  /** Plugin ids this one depends on; installing this plugin installs these first. */
  dependsOn: string[];
  /** Previous ids this plugin was known as, for future doctor/migration use. Not consumed by v1 logic. */
  renamedFrom?: string[];
  /** When "always-user", this plugin's MCP servers register at user scope regardless of the requested install scope (e.g. browser availability is a machine concept, not a per-repo one). */
  mcpScope?: "always-user";
  components: {
    /** Relative paths (within the plugin's own directory) to agent markdown files; each is copied to `.claude/agents/<pluginId>.md`. */
    agentFiles?: string[];
    /** Relative path (within the plugin's own directory) to a directory containing SKILL.md (+ any sibling files); copied to `.claude/skills/<pluginId>/`. */
    skillDir?: string;
    mcpServers?: TMcpServerSpec[];
  };
  studioExtension?: TStudioExtension;
  /** Relative path to a usage-guide markdown file, shown after install. Defaults to "USAGE.md". */
  usageFile?: string;
};

export type TInstalledFileRecord = {
  path: string;
  sha256: string;
};

export type TInstalledMcpServerRecord = {
  name: string;
  scope: TInstallScope;
};

export type TInstalledPluginRecord = {
  pluginId: string;
  version: string;
  scope: TInstallScope;
  installedAt: string;
  files: TInstalledFileRecord[];
  mcpServers: TInstalledMcpServerRecord[];
};

export type TPluginStateFile = {
  installed: TInstalledPluginRecord[];
};

export type TPlanFileEntry = {
  targetPath: string;
  isNew: boolean;
  driftDetected: boolean;
};

export type TPlanStep = {
  pluginId: string;
  manifest: TPluginManifest;
  /** True when this plugin is already installed (at either scope) and this plan will skip it. */
  alreadySatisfied: boolean;
  satisfiedAtScope?: TInstallScope;
  filesToWrite: TPlanFileEntry[];
  mcpServersToRegister: Array<{ name: string; scope: TInstallScope }>;
};

export type TInstallPlan = {
  requestedIds: string[];
  /** Full resolved order, dependencies first, deduped. */
  order: string[];
  steps: TPlanStep[];
};
