/**
 * Hand-maintained mirror of src/core/plugins/plugin-types.ts — the browser-safe shapes returned by
 * the local Plugins API (src/core/ai/studio/plugins-routes.ts). Keep in sync with the backend.
 */

export type TInstallScope = "user" | "project";

export type TPluginKind = "agent" | "skill" | "mcp-bundle";

export type TMcpServerSpec = {
  name: string;
  package: string;
  args: string[];
};

export type TStudioExtensionFileRule = {
  match: string;
  render: "markdown" | "text" | "image-gallery";
};

export type TStudioExtension = {
  id: string;
  label: string;
  instanceGlob: string;
  instanceLabel: string;
  files: TStudioExtensionFileRule[];
};

export type TPluginManifest = {
  id: string;
  version: string;
  displayName: string;
  description: string;
  kind: TPluginKind;
  dependsOn: string[];
  renamedFrom?: string[];
  mcpScope?: "always-user";
  components: {
    agentFiles?: string[];
    skillDir?: string;
    mcpServers?: TMcpServerSpec[];
  };
  studioExtension?: TStudioExtension;
  usageFile?: string;
};

export type TPluginCatalogEntry = {
  manifest: TPluginManifest;
  installed: { scope: TInstallScope; version: string } | null;
};

export type TPlanFileEntry = {
  targetPath: string;
  isNew: boolean;
  driftDetected: boolean;
};

export type TPlanStep = {
  pluginId: string;
  manifest: TPluginManifest;
  alreadySatisfied: boolean;
  satisfiedAtScope?: TInstallScope;
  filesToWrite: TPlanFileEntry[];
  mcpServersToRegister: Array<{ name: string; scope: TInstallScope }>;
};

export type TInstallPlan = {
  requestedIds: string[];
  order: string[];
  steps: TPlanStep[];
};

export type TPluginRemoveResult =
  | { blockedBy: string[] }
  | { removedPluginIds: string[]; removedFiles: string[]; removedMcpServers: string[] };

export type TPluginUpdateResult = {
  pluginId: string;
  scope: TInstallScope;
  fromVersion: string;
  toVersion: string;
  updatedFiles: string[];
  reregisteredMcpServers: string[];
};

export type TPluginDoctorIssue = {
  pluginId: string;
  scope: TInstallScope;
  kind: "missing-from-registry" | "file-drifted" | "file-missing" | "mcp-server-missing" | "missing-dependency" | "update-available";
  detail: string;
};

export type TPluginDoctorReport = {
  installedCount: number;
  issues: TPluginDoctorIssue[];
};

export type TStudioExtensionInstance = {
  name: string;
  label: string;
  path: string;
};

export type TStudioExtensionFileEntry = {
  relativePath: string;
  render: TStudioExtensionFileRule["render"];
};
