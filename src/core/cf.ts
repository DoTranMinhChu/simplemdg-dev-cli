import type { TCloudFoundryApp, TCloudFoundryOrgEntry, TCloudFoundryTarget } from "./types";
import { runCommand } from "./process";

export function buildCloudFoundryTargetKey(target: TCloudFoundryTarget): string {
  return [
    target.apiEndpoint ?? "unknown-api",
    target.org ?? "unknown-org",
    target.space ?? "unknown-space",
  ].join("|");
}

export async function readCloudFoundryTarget(): Promise<TCloudFoundryTarget> {
  const result = await runCommand("cf", ["target"]);

  if (result.exitCode !== 0) {
    return {};
  }

  const target: TCloudFoundryTarget = {};

  for (const line of result.stdout.split(/\r?\n/)) {
    const [rawKey, ...rawValueParts] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rawValueParts.join(":").trim();

    if (key === "api endpoint") target.apiEndpoint = value;
    if (key === "user") target.user = value;
    if (key === "org") target.org = value;
    if (key === "space") target.space = value;
  }

  return target;
}


export async function setCloudFoundryApiEndpoint(apiEndpoint: string): Promise<number> {
  const result = await runCommand("cf", ["api", apiEndpoint]);

  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);

  return result.exitCode;
}

export async function authenticateCloudFoundry(options: {
  username: string;
  password: string;
}): Promise<number> {
  const result = await runCommand("cf", ["auth", options.username, options.password]);

  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);

  return result.exitCode;
}

export async function targetCloudFoundryOrg(org: string): Promise<number> {
  const result = await runCommand("cf", ["target", "-o", org]);

  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);

  return result.exitCode;
}

export async function targetCloudFoundrySpace(space: string): Promise<number> {
  const result = await runCommand("cf", ["target", "-s", space]);

  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);

  return result.exitCode;
}

export async function listCloudFoundryOrganizations(): Promise<string[]> {
  const result = await runCommand("cf", ["orgs"]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "cf orgs failed");
  }

  return parseCloudFoundryNameList(result.stdout, "name");
}

export async function listCloudFoundrySpaces(): Promise<string[]> {
  const result = await runCommand("cf", ["spaces"]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "cf spaces failed");
  }

  return parseCloudFoundryNameList(result.stdout, "name");
}

function parseCloudFoundryNameList(output: string, headerName: string): string[] {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.toLowerCase() === headerName.toLowerCase());

  if (headerIndex === -1) {
    return [];
  }

  return lines
    .slice(headerIndex + 1)
    .filter((line) => !/^Getting\s+/i.test(line))
    .filter((line) => !/^OK$/i.test(line))
    .filter(Boolean);
}
export function inferCloudFoundryRegionFromApiEndpoint(apiEndpoint: string): string {
  const match = apiEndpoint.match(/api\.cf\.([^.]+)\./i);
  return match?.[1] ?? apiEndpoint.replace(/^https?:\/\//, "");
}

export async function scanCloudFoundryOrganizationsAcrossRegions(apiEndpoints: string[], credentials: Array<{ apiEndpoint: string; username: string; password?: string }> = []): Promise<TCloudFoundryOrgEntry[]> {
  const originalTarget = await readCloudFoundryTarget();
  const orgEntries: TCloudFoundryOrgEntry[] = [];
  const uniqueApiEndpoints = [...new Set(apiEndpoints.map((apiEndpoint) => apiEndpoint.trim()).filter(Boolean))];

  for (const apiEndpoint of uniqueApiEndpoints) {
    const apiResult = await runCommand("cf", ["api", apiEndpoint]);

    if (apiResult.exitCode !== 0) {
      continue;
    }

    let orgResult = await runCommand("cf", ["orgs"]);

    if (orgResult.exitCode !== 0) {
      const endpointCredentials = [
        ...credentials.filter((item) => item.apiEndpoint === apiEndpoint && item.password?.trim()),
        ...credentials.filter((item) => item.apiEndpoint !== apiEndpoint && item.password?.trim()),
      ];
      const triedUsers = new Set<string>();

      for (const credential of endpointCredentials) {
        const credentialKey = `${credential.username}|${credential.password ?? ""}`;

        if (triedUsers.has(credentialKey)) {
          continue;
        }

        triedUsers.add(credentialKey);
        const authResult = await runCommand("cf", ["auth", credential.username, credential.password as string]);

        if (authResult.exitCode !== 0) {
          continue;
        }

        orgResult = await runCommand("cf", ["orgs"]);

        if (orgResult.exitCode === 0) {
          break;
        }
      }
    }

    if (orgResult.exitCode !== 0) {
      continue;
    }

    const organizations = parseCloudFoundryNameList(orgResult.stdout, "name");
    const region = inferCloudFoundryRegionFromApiEndpoint(apiEndpoint);

    for (const org of organizations) {
      let spaces: string[] = [];
      const orgTargetResult = await runCommand("cf", ["target", "-o", org]);

      if (orgTargetResult.exitCode === 0) {
        const spacesResult = await runCommand("cf", ["spaces"]);
        spaces = spacesResult.exitCode === 0 ? parseCloudFoundryNameList(spacesResult.stdout, "name") : [];
      }

      orgEntries.push({
        apiEndpoint,
        region,
        org,
        spaceCount: spaces.length,
        spaces,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  if (originalTarget.apiEndpoint) {
    await runCommand("cf", ["api", originalTarget.apiEndpoint]);

    if (originalTarget.org) {
      await runCommand("cf", ["target", "-o", originalTarget.org]);
    }

    if (originalTarget.space) {
      await runCommand("cf", ["target", "-s", originalTarget.space]);
    }
  }

  return orgEntries.sort((left, right) => {
    const byOrg = left.org.localeCompare(right.org);
    return byOrg !== 0 ? byOrg : left.region.localeCompare(right.region);
  });
}

export async function loginCloudFoundry(options: {
  apiEndpoint: string;
  username: string;
  password: string;
  org: string;
  space?: string;
}): Promise<number> {
  const apiExitCode = await setCloudFoundryApiEndpoint(options.apiEndpoint);

  if (apiExitCode !== 0) {
    return apiExitCode;
  }

  const authExitCode = await authenticateCloudFoundry({
    username: options.username,
    password: options.password,
  });

  if (authExitCode !== 0) {
    return authExitCode;
  }

  const orgExitCode = await targetCloudFoundryOrg(options.org);

  if (orgExitCode !== 0) {
    return orgExitCode;
  }

  if (!options.space?.trim()) {
    return 0;
  }

  return targetCloudFoundrySpace(options.space.trim());
}

export async function listCloudFoundryApps(): Promise<TCloudFoundryApp[]> {
  const result = await runCommand("cf", ["apps"]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "cf apps failed");
  }

  return parseCloudFoundryApps(result.stdout);
}

export function parseCloudFoundryApps(output: string): TCloudFoundryApp[] {
  const lines = output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const nameHeaderIndex = lines.findIndex((line) => /^name\s+/i.test(line.trim()));

  if (nameHeaderIndex === -1) {
    return [];
  }

  const result: TCloudFoundryApp[] = [];

  for (const line of lines.slice(nameHeaderIndex + 1)) {
    if (/^Getting apps/i.test(line) || /^OK$/i.test(line)) {
      continue;
    }

    const columns = line.trim().split(/\s{2,}|\t+/).filter(Boolean);
    const [name, requestedState, processes, routes] = columns;

    if (name && name !== "name") {
      result.push({ name, requestedState, processes, routes });
    }
  }

  return result;
}
