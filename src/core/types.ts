export type TKeyValueMap = Record<string, string>;

export type TRepositoryInfo = {
  repositoryPath: string;
};

export type TScannedVariable = {
  variableName: string;
  filePath: string;
  occurrences: number;
};

export type TInstallRepositoryOptions = {
  repositoryPath: string;
  installCommand: string;
  variableValues: Record<string, string>;
  temporaryOverrides: Record<string, string>;
  filePatterns: string[];
  onLog?: (value: string) => void;
  onErrorLog?: (value: string) => void;
};

export type TInstallRepositoryResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type TDoctorPackageResult = {
  packageName: string;
  versions: string[];
  occurrences: TPackageOccurrence[];
  hasMultipleVersions: boolean;
};

export type TPackageOccurrence = {
  version?: string;
  path?: string;
};

export type TLoadedLocationConflict = {
  packageName: string;
  rawMessage: string;
};

export type TPackageConflictInspection = {
  packageName: string;
  suggestedVersions: string[];
  doctorResult: TDoctorPackageResult;
};

export type TCloudFoundryTarget = {
  apiEndpoint?: string;
  user?: string;
  org?: string;
  space?: string;
};

export type TCloudFoundryApp = {
  name: string;
  requestedState?: string;
  processes?: string;
  routes?: string;
};

export type TCloudFoundryOrgEntry = {
  apiEndpoint: string;
  region: string;
  org: string;
  spaceCount?: number;
  spaces?: string[];
  updatedAt: string;
};

export type TCloudFoundryLoginProfile = {
  apiEndpoint: string;
  org: string;
  space?: string;
  username: string;
  password?: string;
  updatedAt: string;
};

export type TCloudFoundryAppsCacheEntry = {
  targetKey: string;
  apps: TCloudFoundryApp[];
  updatedAt: string;
};

export type TCloudFoundryCache = {
  loginProfiles: TCloudFoundryLoginProfile[];
  appListsByTarget: Record<string, TCloudFoundryAppsCacheEntry>;
  orgsAcrossRegions: TCloudFoundryOrgEntry[];
  orgsAcrossRegionsUpdatedAt?: string;
  envFileNames: string[];
  selectedApps: string[];
};

export type TCdsCache = {
  profiles: string[];
  ports: string[];
  services: string[];
  edmxOutputFileNames: string[];
  models: string[];
};

export type TNpmrcPackageEntry = {
  packageId: string;
  packageName: string;
  scope: string;
  host: string;
  updatedAt: string;
};

export type TNpmrcTokenEntry = {
  scope: string;
  host: string;
  token: string;
  label: string;
  updatedAt: string;
};

export type TNpmrcProjectCache = {
  projectName: string;
  packageIds: string[];
  packages: TNpmrcPackageEntry[];
};

export type TNpmrcCache = {
  hosts: string[];
  scopes: string[];
  packageIds: string[];
  packages: TNpmrcPackageEntry[];
  packageIdsByProject: Record<string, TNpmrcProjectCache>;
  tokens: string[];
  tokenEntries: TNpmrcTokenEntry[];
  outputFileNames: string[];
};

export type TSimpleMdgCache = {
  variables: Record<string, string[]>;
  overrides: Record<string, string[]>;
  cloudFoundry: TCloudFoundryCache;
  cds: TCdsCache;
  npmrc: TNpmrcCache;
};

export type TParsedCloudFoundryEnvironment = {
  VCAP_SERVICES?: unknown;
  VCAP_APPLICATION?: unknown;
  [key: string]: unknown;
};
