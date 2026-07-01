import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import type {
  TCloudFoundryApp,
  TCloudFoundryAppsCacheEntry,
  TCloudFoundryLoginProfile,
  TCloudFoundryOrgEntry,
  TSimpleMdgCache,
  TNpmrcPackageEntry,
  TNpmrcTokenEntry,
} from "./types";

const CACHE_DIRECTORY = path.join(os.homedir(), ".simplemdg");
const CACHE_FILE_PATH = path.join(CACHE_DIRECTORY, "cache.json");
const MAX_HISTORY_ITEMS = 20;
const MAX_NPMRC_PACKAGE_ITEMS = 500;

const EMPTY_CACHE: TSimpleMdgCache = {
  variables: {},
  overrides: {},
  cloudFoundry: {
    loginProfiles: [],
    appListsByTarget: {},
    orgsAcrossRegions: [],
    orgsAcrossRegionsUpdatedAt: undefined,
    envFileNames: ["default-env.json", "default-envBTP.json", "default-envBTPConfigAdmin.json"],
    selectedApps: [],
  },
  cds: {
    profiles: ["hybrid", "development", "production"],
    ports: ["4004", "4005", "4010"],
    services: [],
    edmxOutputFileNames: [],
    models: ["srv", "."],
  },
  npmrc: {
    hosts: ["gitlab.simplemdg.com"],
    scopes: ["@simplemdg"],
    packageIds: [],
    packages: [],
    packageIdsByProject: {},
    tokens: [],
    tokenEntries: [],
    outputFileNames: [".npmrc"],
  },
};

function cloneEmptyCache(): TSimpleMdgCache {
  return JSON.parse(JSON.stringify(EMPTY_CACHE)) as TSimpleMdgCache;
}

function uniqueLatest(values: string[]): string[] {
  const normalizedValues = values.map((value) => value.trim()).filter(Boolean);
  return [...new Set(normalizedValues)].slice(0, MAX_HISTORY_ITEMS);
}

function uniquePackageEntries(values: TNpmrcPackageEntry[]): TNpmrcPackageEntry[] {
  const result: TNpmrcPackageEntry[] = [];
  const keys = new Set<string>();

  for (const value of values) {
    const packageId = value.packageId.trim();
    const scope = value.scope.trim();
    const host = value.host.trim();

    if (!packageId || !scope || !host) {
      continue;
    }

    const key = `${host}|${scope}|${packageId}`;

    if (keys.has(key)) {
      continue;
    }

    keys.add(key);
    result.push({
      ...value,
      packageId,
      packageName: value.packageName.trim() || packageId,
      scope,
      host,
    });
  }

  return result.slice(0, MAX_NPMRC_PACKAGE_ITEMS);
}

function uniqueTokenEntries(values: TNpmrcTokenEntry[]): TNpmrcTokenEntry[] {
  const result: TNpmrcTokenEntry[] = [];
  const keys = new Set<string>();

  for (const value of values) {
    const scope = value.scope.trim();
    const host = value.host.trim();

    if (!scope || !host || !value.token.trim()) {
      continue;
    }

    const key = `${host}|${scope}`;

    if (keys.has(key)) {
      continue;
    }

    keys.add(key);
    result.push({
      ...value,
      scope,
      host,
      token: value.token.trim(),
      label: value.label.trim() || `${scope} @ ${host}`,
    });
  }

  return result.slice(0, MAX_HISTORY_ITEMS);
}

function migrateNpmrcProjectCache(
  value: TSimpleMdgCache["npmrc"]["packageIdsByProject"],
): TSimpleMdgCache["npmrc"]["packageIdsByProject"] {
  const migratedEntries: TSimpleMdgCache["npmrc"]["packageIdsByProject"] = {};

  for (const [projectName, projectCache] of Object.entries(value ?? {})) {
    migratedEntries[projectName] = {
      projectName: projectCache.projectName ?? projectName,
      packageIds: projectCache.packageIds ?? [],
      packages: projectCache.packages ?? [],
    };
  }

  return migratedEntries;
}

export async function readCache(): Promise<TSimpleMdgCache> {
  if (!(await fs.pathExists(CACHE_FILE_PATH))) {
    return cloneEmptyCache();
  }

  const cache = await fs.readJson(CACHE_FILE_PATH).catch(() => cloneEmptyCache()) as Partial<TSimpleMdgCache>;

  return {
    variables: cache.variables ?? {},
    overrides: cache.overrides ?? {},
    cloudFoundry: {
      loginProfiles: cache.cloudFoundry?.loginProfiles ?? [],
      appListsByTarget: cache.cloudFoundry?.appListsByTarget ?? {},
      orgsAcrossRegions: cache.cloudFoundry?.orgsAcrossRegions ?? [],
      orgsAcrossRegionsUpdatedAt: cache.cloudFoundry?.orgsAcrossRegionsUpdatedAt,
      envFileNames: cache.cloudFoundry?.envFileNames ?? EMPTY_CACHE.cloudFoundry.envFileNames,
      selectedApps: cache.cloudFoundry?.selectedApps ?? [],
    },
    cds: {
      profiles: cache.cds?.profiles ?? EMPTY_CACHE.cds.profiles,
      ports: cache.cds?.ports ?? EMPTY_CACHE.cds.ports,
      services: cache.cds?.services ?? EMPTY_CACHE.cds.services,
      edmxOutputFileNames: cache.cds?.edmxOutputFileNames ?? EMPTY_CACHE.cds.edmxOutputFileNames,
      models: cache.cds?.models ?? EMPTY_CACHE.cds.models,
    },
    npmrc: {
      hosts: cache.npmrc?.hosts ?? EMPTY_CACHE.npmrc.hosts,
      scopes: cache.npmrc?.scopes ?? EMPTY_CACHE.npmrc.scopes,
      packageIds: cache.npmrc?.packageIds ?? EMPTY_CACHE.npmrc.packageIds,
      packages: cache.npmrc?.packages ?? EMPTY_CACHE.npmrc.packages,
      packageIdsByProject: migrateNpmrcProjectCache(cache.npmrc?.packageIdsByProject ?? EMPTY_CACHE.npmrc.packageIdsByProject),
      tokens: cache.npmrc?.tokens ?? EMPTY_CACHE.npmrc.tokens,
      tokenEntries: cache.npmrc?.tokenEntries ?? EMPTY_CACHE.npmrc.tokenEntries,
      outputFileNames: cache.npmrc?.outputFileNames ?? EMPTY_CACHE.npmrc.outputFileNames,
    },
  };
}

export async function writeCache(cache: TSimpleMdgCache): Promise<void> {
  await fs.ensureDir(CACHE_DIRECTORY);
  await fs.writeJson(CACHE_FILE_PATH, cache, { spaces: 2 });
}

export async function rememberVariableValue(variableName: string, value: string): Promise<void> {
  const cache = await readCache();
  cache.variables[variableName] = uniqueLatest([value, ...(cache.variables[variableName] ?? [])]);
  await writeCache(cache);
}

export async function rememberOverrideValue(packageName: string, version: string): Promise<void> {
  const cache = await readCache();
  cache.overrides[packageName] = uniqueLatest([version, ...(cache.overrides[packageName] ?? [])]);
  await writeCache(cache);
}

export async function rememberResolvedOverrideVersions(overrides: Record<string, string>): Promise<void> {
  for (const [packageName, version] of Object.entries(overrides)) {
    await rememberOverrideValue(packageName, version);
  }
}

export async function rememberCloudFoundryLoginProfile(profile: TCloudFoundryLoginProfile): Promise<void> {
  const cache = await readCache();
  const nextProfiles = cache.cloudFoundry.loginProfiles.filter((item) => {
    return !(item.apiEndpoint === profile.apiEndpoint && item.org === profile.org && item.space === profile.space && item.username === profile.username);
  });

  cache.cloudFoundry.loginProfiles = [profile, ...nextProfiles].slice(0, MAX_HISTORY_ITEMS);
  await writeCache(cache);
}

export async function clearCloudFoundryLoginProfiles(): Promise<void> {
  const cache = await readCache();
  cache.cloudFoundry.loginProfiles = [];
  await writeCache(cache);
}

export async function rememberCloudFoundryApps(targetKey: string, apps: TCloudFoundryApp[]): Promise<void> {
  const cache = await readCache();
  const entry: TCloudFoundryAppsCacheEntry = {
    targetKey,
    apps,
    updatedAt: new Date().toISOString(),
  };

  cache.cloudFoundry.appListsByTarget[targetKey] = entry;
  await writeCache(cache);
}


export async function rememberCloudFoundryOrgEntries(orgEntries: TCloudFoundryOrgEntry[]): Promise<void> {
  const cache = await readCache();
  cache.cloudFoundry.orgsAcrossRegions = orgEntries;
  cache.cloudFoundry.orgsAcrossRegionsUpdatedAt = new Date().toISOString();
  await writeCache(cache);
}

export async function rememberSelectedApp(appName: string): Promise<void> {
  const cache = await readCache();
  cache.cloudFoundry.selectedApps = uniqueLatest([appName, ...cache.cloudFoundry.selectedApps]);
  await writeCache(cache);
}

export async function rememberEnvironmentFileName(fileName: string): Promise<void> {
  const cache = await readCache();
  cache.cloudFoundry.envFileNames = uniqueLatest([fileName, ...cache.cloudFoundry.envFileNames]);
  await writeCache(cache);
}

export async function rememberCdsProfile(profile: string): Promise<void> {
  const cache = await readCache();
  cache.cds.profiles = uniqueLatest([profile, ...cache.cds.profiles]);
  await writeCache(cache);
}

export async function rememberCdsPort(port: string): Promise<void> {
  const cache = await readCache();
  cache.cds.ports = uniqueLatest([port, ...cache.cds.ports]);
  await writeCache(cache);
}

export async function rememberCdsService(serviceName: string): Promise<void> {
  const cache = await readCache();
  cache.cds.services = uniqueLatest([serviceName, ...cache.cds.services]);
  await writeCache(cache);
}

export async function rememberCdsEdmxOutputFileName(fileName: string): Promise<void> {
  const cache = await readCache();
  cache.cds.edmxOutputFileNames = uniqueLatest([fileName, ...cache.cds.edmxOutputFileNames]);
  await writeCache(cache);
}

export async function rememberCdsModel(model: string): Promise<void> {
  const cache = await readCache();
  cache.cds.models = uniqueLatest([model, ...cache.cds.models]);
  await writeCache(cache);
}


export async function rememberNpmrcHost(host: string): Promise<void> {
  const cache = await readCache();
  cache.npmrc.hosts = uniqueLatest([host, ...cache.npmrc.hosts]);
  await writeCache(cache);
}

export async function rememberNpmrcScope(scope: string): Promise<void> {
  const cache = await readCache();
  cache.npmrc.scopes = uniqueLatest([scope, ...cache.npmrc.scopes]);
  await writeCache(cache);
}

export async function rememberNpmrcPackageIds(projectName: string, packageIds: string[]): Promise<void> {
  const fallbackEntries = packageIds.map<TNpmrcPackageEntry>((packageId) => ({
    packageId,
    packageName: packageId,
    scope: "@simplemdg",
    host: "gitlab.simplemdg.com",
    updatedAt: new Date().toISOString(),
  }));

  await rememberNpmrcPackages(projectName, fallbackEntries);
}

export async function rememberNpmrcPackages(projectName: string, packages: TNpmrcPackageEntry[]): Promise<void> {
  const cache = await readCache();
  const nextPackageIds = packages.map((item) => item.packageId);
  cache.npmrc.packageIds = uniqueLatest([...nextPackageIds, ...cache.npmrc.packageIds]);
  cache.npmrc.packages = uniquePackageEntries([...packages, ...cache.npmrc.packages]);

  const projectKey = projectName.trim();

  if (projectKey) {
    const currentProjectCache = cache.npmrc.packageIdsByProject[projectKey];
    cache.npmrc.packageIdsByProject[projectKey] = {
      projectName: projectKey,
      packageIds: uniqueLatest([...nextPackageIds, ...(currentProjectCache?.packageIds ?? [])]),
      packages: uniquePackageEntries([...packages, ...(currentProjectCache?.packages ?? [])]),
    };
  }

  await writeCache(cache);
}

export async function rememberNpmrcToken(token: string): Promise<void> {
  const cache = await readCache();
  cache.npmrc.tokens = uniqueLatest([token, ...cache.npmrc.tokens]);
  await writeCache(cache);
}

export async function rememberNpmrcTokenEntry(entry: TNpmrcTokenEntry): Promise<void> {
  const cache = await readCache();
  cache.npmrc.tokens = uniqueLatest([entry.token, ...cache.npmrc.tokens]);
  cache.npmrc.tokenEntries = uniqueTokenEntries([entry, ...cache.npmrc.tokenEntries]);
  await writeCache(cache);
}

export async function rememberNpmrcOutputFileName(fileName: string): Promise<void> {
  const cache = await readCache();
  cache.npmrc.outputFileNames = uniqueLatest([fileName, ...cache.npmrc.outputFileNames]);
  await writeCache(cache);
}
