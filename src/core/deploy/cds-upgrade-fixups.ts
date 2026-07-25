/**
 * Known, documented config-level breaking changes between CDS major versions
 * — deliberately a small, explicit, linear ruleset, NOT a generic CDS-file
 * rewrite engine. Real `.cds` schema syntax is left entirely alone; every
 * rule here only touches `package.json` config, and only for changes SAP has
 * actually published in capire's release notes (cited in each rule's
 * `docRef`). This is a STARTING SEED LIST, not a claim of completeness — the
 * full breaking-change surface across every past/future CDS major version
 * jump isn't something to fully enumerate up front. Extend `KNOWN_CDS_FIXUPS`
 * as the team hits new cases in real upgrades.
 *
 * Anything a rule recognizes but can't confidently migrate (e.g. legacy
 * build config in an unfamiliar shape) is reported via `note`, never guessed
 * — the real `cds compile` error is what surfaces for anything this seed
 * list doesn't (yet) cover.
 */

export type TCdsFixupContext = {
  /** Mutated in place by `apply()` — the caller re-serializes it once after `runKnownFixups` returns. */
  packageJson: Record<string, unknown>;
  fromMajor: number;
  toMajor: number;
};

export type TCdsFixupOutcome = { applied: boolean; note: string };

export type TCdsFixupRule = {
  id: string;
  title: string;
  docRef: string;
  detect: (ctx: TCdsFixupContext) => boolean;
  apply: (ctx: TCdsFixupContext) => TCdsFixupOutcome;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") result[key] = entry;
  }
  return result;
}

function majorOf(versionRange: string | undefined): number | undefined {
  const match = versionRange?.match(/(\d+)/);
  return match ? Number(match[1]) : undefined;
}

/**
 * capire (Feb 2025 changelog, https://cap.cloud.sap/docs/releases/2025/feb25): "cds build no longer
 * supports the undocumented legacy build configuration through cds.data and cds.service" in
 * package.json. There's no single, safe generic mapping from every possible legacy shape to the
 * modern `cds.build.tasks` array we've verified — so this rule only ever reports the finding, it
 * never guesses a migration.
 */
const LEGACY_BUILD_CONFIG_RULE: TCdsFixupRule = {
  id: "legacy-build-config",
  title: "Legacy cds.data/cds.service build config (cds9 drops support)",
  docRef: "https://cap.cloud.sap/docs/releases/2025/feb25",
  detect: (ctx) => ctx.toMajor >= 9 && Boolean(asRecord(asRecord(ctx.packageJson.cds)?.data) || asRecord(asRecord(ctx.packageJson.cds)?.service)),
  apply: () => ({
    applied: false,
    note: "Found legacy cds.data/cds.service build config — cds9 no longer supports it, but there's no safe automatic mapping to cds.build.tasks. Migrate this by hand before merging.",
  }),
};

/**
 * capire (Feb 2025 changelog): "@cap-js/cds-test package will be required for tests to run" under
 * cds9. Only added when the repo actually runs tests (a real `test` npm script, not the default
 * npm-init placeholder) — a repo with no real tests doesn't need this dependency.
 */
const CDS_TEST_DEVDEPENDENCY_RULE: TCdsFixupRule = {
  id: "cds-test-devdependency",
  title: "Add @cap-js/cds-test devDependency (required for tests under cds9)",
  docRef: "https://cap.cloud.sap/docs/releases/2025/feb25",
  detect: (ctx) => {
    if (ctx.toMajor < 9) return false;
    const scripts = asStringRecord(ctx.packageJson.scripts);
    const hasRealTestScript = Boolean(scripts.test) && !/no test specified/i.test(scripts.test);
    const devDependencies = asStringRecord(ctx.packageJson.devDependencies);
    return hasRealTestScript && !devDependencies["@cap-js/cds-test"];
  },
  apply: (ctx) => {
    const packageJson = ctx.packageJson as { devDependencies?: Record<string, string> };
    packageJson.devDependencies = { ...packageJson.devDependencies, "@cap-js/cds-test": "^1" };
    return { applied: true, note: "Added @cap-js/cds-test@^1 to devDependencies (required for tests under cds9)." };
  },
};

/**
 * capire (Feb 2025 changelog): "cds lint now requires package eslint to be installed as an
 * application dependency" and only supports ESLint v9 — it's "no longer bundled with @sap/cds-dk".
 * Only touches repos that already use eslint/cds lint — never introduces eslint to a repo that
 * never had it.
 */
const ESLINT_V9_DEVDEPENDENCY_RULE: TCdsFixupRule = {
  id: "eslint-v9-devdependency",
  title: "Bump eslint to v9 as an explicit devDependency (cds lint requirement under cds9)",
  docRef: "https://cap.cloud.sap/docs/releases/2025/feb25",
  detect: (ctx) => {
    if (ctx.toMajor < 9) return false;
    const scripts = asStringRecord(ctx.packageJson.scripts);
    const devDependencies = asStringRecord(ctx.packageJson.devDependencies);
    const usesLint = Object.values(scripts).some((script) => /\b(eslint|cds\s+lint)\b/.test(script)) || Boolean(devDependencies.eslint);
    const eslintMajor = majorOf(devDependencies.eslint);
    return usesLint && (eslintMajor === undefined || eslintMajor < 9);
  },
  apply: (ctx) => {
    const packageJson = ctx.packageJson as { devDependencies?: Record<string, string> };
    packageJson.devDependencies = { ...packageJson.devDependencies, eslint: "^9" };
    return { applied: true, note: "Set eslint devDependency to ^9 (cds lint under cds9 requires it as an explicit app dependency, no longer bundled with @sap/cds-dk)." };
  },
};

export const KNOWN_CDS_FIXUPS: TCdsFixupRule[] = [LEGACY_BUILD_CONFIG_RULE, CDS_TEST_DEVDEPENDENCY_RULE, ESLINT_V9_DEVDEPENDENCY_RULE];

export type TCdsFixupResult = { id: string; title: string; applied: boolean; note: string };

/** Runs every known rule against `ctx.packageJson` in order, mutating it in place. Idempotent — a rule that already-applied fixup makes `detect` return false on a second pass. */
export function runKnownFixups(ctx: TCdsFixupContext): { changed: boolean; results: TCdsFixupResult[] } {
  const results: TCdsFixupResult[] = [];
  let changed = false;

  for (const rule of KNOWN_CDS_FIXUPS) {
    if (!rule.detect(ctx)) continue;
    const outcome = rule.apply(ctx);
    if (outcome.applied) changed = true;
    results.push({ id: rule.id, title: rule.title, applied: outcome.applied, note: outcome.note });
  }

  return { changed, results };
}
