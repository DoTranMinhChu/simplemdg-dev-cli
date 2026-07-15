import path from "node:path";
import fastGlob from "fast-glob";
import fs from "fs-extra";
import type { TStudioExtension, TStudioExtensionFileRule } from "./plugin-types";

export type TStudioExtensionInstance = {
  name: string;
  label: string;
  path: string;
};

export type TStudioExtensionFileEntry = {
  relativePath: string;
  render: TStudioExtensionFileRule["render"];
};

/** Lists artifact "instances" for a Studio extension (e.g. one per `.claude/evidence/<TICKET-KEY>/`
 * directory) under a given project root. Newest-looking (by name, descending) first — good enough
 * without needing to stat every instance for an mtime. */
export async function listStudioExtensionInstances(extension: TStudioExtension, projectRoot: string): Promise<TStudioExtensionInstance[]> {
  const matches = await fastGlob(extension.instanceGlob, { cwd: projectRoot, onlyDirectories: true, absolute: true });

  return matches
    .map((absolutePath) => {
      // fast-glob always returns forward-slash paths, even on Windows — normalize to the native
      // separator so this is directly comparable with path.join/path.normalize output downstream
      // (resolveStudioExtensionFile's containment check depends on both sides matching).
      const normalizedPath = path.normalize(absolutePath);
      const name = path.basename(normalizedPath);
      return { name, label: extension.instanceLabel.replace("{basename}", name), path: normalizedPath };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Only returns an instance that's a real glob match under `projectRoot` for this extension —
 * never trusts a client-supplied instance name as a literal path. */
export async function findStudioExtensionInstance(extension: TStudioExtension, projectRoot: string, instanceName: string): Promise<TStudioExtensionInstance | undefined> {
  const instances = await listStudioExtensionInstances(extension, projectRoot);
  return instances.find((instance) => instance.name === instanceName);
}

export async function listStudioExtensionFiles(extension: TStudioExtension, instancePath: string): Promise<TStudioExtensionFileEntry[]> {
  const entries: TStudioExtensionFileEntry[] = [];

  for (const rule of extension.files) {
    const matches = await fastGlob(rule.match, { cwd: instancePath, onlyFiles: true });
    for (const relativePath of matches) {
      entries.push({ relativePath, render: rule.render });
    }
  }

  return entries;
}

/** Resolves an instance-relative file path to an absolute path, guaranteeing it stays within the
 * instance directory — the same containment pattern `serveAiStudioAsset` uses in
 * `ai-studio-server.ts`, needed here because `relativePath` arrives from an HTTP query param. */
export function resolveStudioExtensionFile(instancePath: string, relativePath: string): string | undefined {
  const normalizedInstancePath = path.normalize(instancePath);
  const resolved = path.normalize(path.join(normalizedInstancePath, relativePath));
  if (resolved !== normalizedInstancePath && !resolved.startsWith(normalizedInstancePath + path.sep)) return undefined;
  return resolved;
}

export async function readStudioExtensionFile(instancePath: string, relativePath: string): Promise<{ path: string; content: Buffer } | undefined> {
  const resolved = resolveStudioExtensionFile(instancePath, relativePath);
  if (!resolved) return undefined;
  if (!(await fs.pathExists(resolved))) return undefined;
  const stat = await fs.stat(resolved);
  if (!stat.isFile()) return undefined;
  return { path: resolved, content: await fs.readFile(resolved) };
}
