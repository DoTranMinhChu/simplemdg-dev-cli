// Guards against silently publishing a broken package: something on a dev machine can empty
// dist/core/db/studio-dist AFTER `npm run build` finishes (seen firsthand during this session —
// antivirus/cloud-sync/a concurrent process are the likely suspects, never fully identified). If
// that happens between build and publish, `npm publish` would otherwise ship a CLI whose
// `smdg ai studio` permanently prints "AI Studio UI is not built" for every downstream user. Run
// this right before packing (see "prepack" in package.json) so a broken dist/ fails loudly instead.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const studioDist = path.join(root, "dist", "core", "db", "studio-dist");

const problems = [];

for (const file of ["index.html", "ai-studio.html"]) {
  const filePath = path.join(studioDist, file);
  if (!fs.existsSync(filePath)) problems.push(`Missing ${path.relative(root, filePath)}`);
}

const assetsDir = path.join(studioDist, "assets");
const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];
if (assetFiles.length === 0) problems.push(`${path.relative(root, assetsDir)} is empty`);

const cliEntry = path.join(root, "dist", "index.js");
if (!fs.existsSync(cliEntry)) problems.push(`Missing ${path.relative(root, cliEntry)}`);

if (problems.length > 0) {
  console.error("Build verification failed — dist/ is incomplete:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("\nDo not publish this package. Re-run `npm run build` and check nothing else is writing to dist/ concurrently.");
  process.exit(1);
}

console.log(`Build verification passed — dist/ contains the CLI bundle and ${assetFiles.length} AI Studio UI asset(s).`);
