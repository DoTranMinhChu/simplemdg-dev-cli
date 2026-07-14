import path from "node:path";
import fs from "fs-extra";
import { getCurrentBranch } from "../../core/git/git-repository";
import { isCommandAvailable } from "../../core/tooling";
import type { TContextFacts } from "../components/ContextBar";

/** Only ever returns facts that were actually detected — never fabricates environment info. */
export async function detectContextFacts(cwd: string): Promise<TContextFacts> {
  const facts: TContextFacts = {};

  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const packageJson = (await fs.pathExists(packageJsonPath)) ? (await fs.readJson(packageJsonPath) as { name?: string }) : undefined;
    facts.project = packageJson?.name ?? path.basename(cwd);
  } catch {
    facts.project = path.basename(cwd);
  }

  try {
    facts.branch = await getCurrentBranch(cwd);
  } catch {
    // Not a git repository, or git unavailable — leave undefined rather than fabricate.
  }

  return facts;
}

export type TToolCheck = { label: string; detected: boolean };

export async function detectToolChecklist(): Promise<TToolCheck[]> {
  const [git, cds, cf] = await Promise.all([
    isCommandAvailable("git"),
    isCommandAvailable("cds"),
    isCommandAvailable("cf"),
  ]);

  return [
    { label: "Git", detected: git },
    { label: "SAP CDS CLI", detected: cds },
    { label: "Cloud Foundry CLI", detected: cf },
  ];
}
