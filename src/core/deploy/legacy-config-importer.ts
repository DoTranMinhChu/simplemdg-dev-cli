import fs from "fs-extra";
import type { TGitLabAuth } from "../gitlab/gitlab-client";
import { listRootGroups } from "../gitlab/gitlab-client";
import { detectOAuthCredentialCandidates } from "../cf/btp-service-credential-parser";
import { saveBtpServiceCredential } from "../cf/btp-service-credential-store";
import { upsertDeployTarget } from "./deploy-target-store";
import type { TCdsVersion } from "./object-type-discovery";
import type { TObjectTypeMode } from "./deploy-target-store";

const KNOWN_OBJECT_TYPE_MODES = new Set(["eventmesh", "eventmesh_v1.6+", "multiple_erp", "multiple_erp_central", "buma", "SAP_SF", "natrol_ecc"]);
const KNOWN_CDS_VERSIONS = new Set(["cds6", "cds7", "cds8"]);

type TLegacyEnvironmentEntry = {
  branch?: string;
  objectTypeMode?: string;
  gitlabGroup?: string;
  cdsVersion?: string;
  isConsolidation?: boolean;
};

type TLegacyBtpSpaceEntry = {
  region?: string;
  space?: string;
  clientId?: string;
  clientSecret?: string;
  url?: string;
};

export type TLegacyImportWarning = { source: "environment" | "btp-space"; key: string; message: string };

export type TLegacyImportResult = {
  importedTargets: number;
  importedCredentials: number;
  warnings: TLegacyImportWarning[];
};

/**
 * Best-effort seed of Deploy Targets / BTP service credentials from the old
 * tool's `environment.json` + `btp-space.json`, so 95+866 lines of existing
 * data don't have to be re-typed by hand. Anything that can't be live-resolved
 * (e.g. an `environment.json` entry whose `gitlabGroup` no longer matches a
 * real GitLab group the logged-in user belongs to) is flagged as a warning
 * and skipped, rather than failing the whole import.
 */
export async function importLegacyToolConfig(options: {
  auth: TGitLabAuth;
  environmentJsonPath?: string;
  btpSpaceJsonPath?: string;
}): Promise<TLegacyImportResult> {
  const warnings: TLegacyImportWarning[] = [];
  let importedTargets = 0;
  let importedCredentials = 0;

  if (options.environmentJsonPath) {
    const groupsResult = await listRootGroups(options.auth, false);
    const groupsByPath = new Map(groupsResult.data.map((group) => [group.full_path.toLowerCase(), group]));

    const environmentData = await fs.readJson(options.environmentJsonPath).catch(() => undefined) as Record<string, TLegacyEnvironmentEntry> | undefined;
    if (!environmentData) {
      warnings.push({ source: "environment", key: options.environmentJsonPath, message: "File not found or not valid JSON." });
    } else {
      for (const [environmentCode, entry] of Object.entries(environmentData)) {
        const groupPath = entry.gitlabGroup?.trim().toLowerCase();
        const group = groupPath ? groupsByPath.get(groupPath) : undefined;

        if (!group) {
          warnings.push({ source: "environment", key: environmentCode, message: `GitLab group '${entry.gitlabGroup ?? ""}' was not found among the logged-in account's groups — add this target manually.` });
          continue;
        }

        const objectTypeMode: TObjectTypeMode = KNOWN_OBJECT_TYPE_MODES.has(entry.objectTypeMode ?? "") ? (entry.objectTypeMode as TObjectTypeMode) : "custom";
        const cdsVersionDefault: TCdsVersion = KNOWN_CDS_VERSIONS.has(entry.cdsVersion ?? "") ? (entry.cdsVersion as TCdsVersion) : "cds8";

        await upsertDeployTarget({
          name: environmentCode,
          gitlabBaseUrl: options.auth.baseUrl,
          gitlabGroupId: group.id,
          gitlabGroupPath: group.full_path,
          defaultBranch: entry.branch?.trim() || "main",
          objectTypeMode,
          cdsVersionDefault,
          isConsolidationDefault: Boolean(entry.isConsolidation),
          ticketCodes: [],
        });
        importedTargets += 1;
      }
    }
  }

  if (options.btpSpaceJsonPath) {
    const btpSpaceData = await fs.readJson(options.btpSpaceJsonPath).catch(() => undefined) as Record<string, Record<string, TLegacyBtpSpaceEntry>> | undefined;
    if (!btpSpaceData) {
      warnings.push({ source: "btp-space", key: options.btpSpaceJsonPath, message: "File not found or not valid JSON." });
    } else {
      for (const [customer, environments] of Object.entries(btpSpaceData)) {
        for (const [environmentName, entry] of Object.entries(environments)) {
          if (!entry.clientId || !entry.clientSecret) {
            // Prod entries in the legacy file commonly omit credentials (no direct prod calls) — skip quietly, not a warning.
            continue;
          }
          if (!entry.region || !entry.space) {
            warnings.push({ source: "btp-space", key: `${customer}.${environmentName}`, message: "Missing region/space — skipped." });
            continue;
          }

          const url = entry.url || `https://${entry.space}.authentication.${entry.region}.hana.ondemand.com`;
          const candidate = detectOAuthCredentialCandidates({
            "legacy-import": [{ name: "legacy-import", credentials: { clientid: entry.clientId, clientsecret: entry.clientSecret, url } }],
          })[0];
          if (!candidate) continue;

          await saveBtpServiceCredential(candidate, {
            name: `${customer} ${environmentName}`,
            region: entry.region,
            org: "",
            space: entry.space,
            tags: ["legacy-import"],
          });
          importedCredentials += 1;
        }
      }
    }
  }

  return { importedTargets, importedCredentials, warnings };
}
