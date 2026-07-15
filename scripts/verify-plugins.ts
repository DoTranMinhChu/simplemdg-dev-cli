// Guards against publishing a broken plugin registry: a bad `dependsOn` id or an accidental
// dependency cycle would otherwise only surface the first time some downstream user runs
// `smdg plugin add`. Run this right before packing (see "prepack" in package.json) so a broken
// registry fails the build instead. Uses the exact same registry-loading and graph-resolution
// code the CLI runs at install time (via tsx, not a reimplementation) so there is nothing here
// that can drift out of sync with production behavior.
import fs from "node:fs";
import path from "node:path";
import { resolveInstallOrder } from "../src/core/plugins/plugin-graph";
import { loadPluginRegistry, getPluginDir } from "../src/core/plugins/plugin-registry";

async function main(): Promise<void> {
  const registry = await loadPluginRegistry();
  const problems: string[] = [];

  if (registry.size === 0) {
    console.error("Plugin registry verification failed: no plugins found under plugins/.");
    process.exit(1);
  }

  try {
    resolveInstallOrder(registry, [...registry.keys()]);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }

  for (const manifest of registry.values()) {
    const pluginDir = await getPluginDir(manifest.id);

    for (const agentFile of manifest.components.agentFiles ?? []) {
      if (!fs.existsSync(path.join(pluginDir, agentFile))) {
        problems.push(`${manifest.id}: declared agent file "${agentFile}" does not exist.`);
      }
    }

    if (manifest.components.skillDir) {
      const skillDirPath = path.join(pluginDir, manifest.components.skillDir);
      if (!fs.existsSync(path.join(skillDirPath, "SKILL.md"))) {
        problems.push(`${manifest.id}: declared skillDir "${manifest.components.skillDir}" has no SKILL.md.`);
      }
    }

    const usagePath = path.join(pluginDir, manifest.usageFile ?? "USAGE.md");
    if (!fs.existsSync(usagePath)) {
      problems.push(`${manifest.id}: missing usage file "${path.relative(pluginDir, usagePath)}".`);
    }
  }

  if (problems.length > 0) {
    console.error("Plugin registry verification failed:");
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  console.log(`Plugin registry verification passed — ${registry.size} plugin(s), no cycles, all declared content files present.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
