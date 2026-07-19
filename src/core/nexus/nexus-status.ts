import type { TGitNexusVersionCheck } from "./gitnexus-runtime";
import type { TGitNexusStatusInfo } from "./nexus-output-parser";
import type { TNexusStatus } from "./nexus-types";

export type TNexusStatusResult = { status: TNexusStatus; message: string };

/** Translates a raw install/version check into the plain-English readiness vocabulary — never leaks "npx"/"exit code"/etc. past this function. */
export function mapInstallStatus(version: TGitNexusVersionCheck): TNexusStatusResult {
  if (version.installed) {
    return { status: "ready", message: `GitNexus ${version.version} is installed.` };
  }

  if (version.reason === "network") {
    return {
      status: "setup-required",
      message: "GitNexus isn't installed yet, and it couldn't be downloaded automatically (no network access right now). Run \"smdg ai nexus setup\" once you're back online.",
    };
  }

  return {
    status: "setup-required",
    message: "GitNexus isn't installed yet. Install it to discover code dependencies, execution flows, and change impact.",
  };
}

/** Translates one repo's registration + freshness state into the product's five-value repo status. */
export function mapRepoStatus(options: { registered: boolean; statusInfo?: TGitNexusStatusInfo; analyzing?: boolean; error?: string }): TNexusStatusResult {
  if (options.error) {
    return { status: "error", message: `GitNexus reported: ${options.error}` };
  }

  if (options.analyzing) {
    return { status: "analyzing", message: "Analyzing this repository now — this can take a few minutes for large repositories." };
  }

  if (!options.registered) {
    return { status: "index-required", message: "This repository hasn't been analyzed yet. Analyze it to discover dependencies and execution flows." };
  }

  if (options.statusInfo?.upToDate === false) {
    return { status: "update-required", message: "The analysis is out of date — this repository has new commits since it was last analyzed." };
  }

  return { status: "ready", message: "Ready." };
}
