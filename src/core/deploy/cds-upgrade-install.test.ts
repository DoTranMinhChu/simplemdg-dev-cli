import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bumpCdsPackageJson } from "./cds-upgrade-install";

let repoPath: string;

beforeEach(async () => {
  repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "smdg-cds-upgrade-install-test-"));
});

afterEach(async () => {
  await fs.remove(repoPath).catch(() => undefined);
});

async function writePackageJson(content: Record<string, unknown>): Promise<void> {
  await fs.writeJson(path.join(repoPath, "package.json"), content, { spaces: 2 });
}

async function readPackageJson(): Promise<Record<string, unknown>> {
  return fs.readJson(path.join(repoPath, "package.json"));
}

describe("bumpCdsPackageJson", () => {
  it("bumps @sap/cds/@sap/cds-dk versions, preserving each entry's existing range prefix", async () => {
    await writePackageJson({ dependencies: { "@sap/cds": "^8.5.0" }, devDependencies: { "@sap/cds-dk": "8.5.0" } });

    const result = await bumpCdsPackageJson(repoPath, "9.7.2", "uat");

    expect(result.changed).toBe(true);
    expect(result.after["dependencies.@sap/cds"]).toBe("^9.7.2");
    expect(result.after["devDependencies.@sap/cds-dk"]).toBe("9.7.2");
    const written = await readPackageJson();
    expect((written.dependencies as Record<string, string>)["@sap/cds"]).toBe("^9.7.2");
  });

  it("substitutes ${..._BRANCH} placeholders with sourceBranch — confirmed real-world failure: npm chokes on the literal placeholder otherwise", async () => {
    await writePackageJson({
      dependencies: {
        "@sap/cds": "8.5.0",
        "@simplemdg/db_common": "${SIMPLEMDG_BRANCH}",
      },
    });

    const result = await bumpCdsPackageJson(repoPath, "9.7.2", "uat");

    expect(result.changed).toBe(true);
    expect(result.substitutedVariables).toEqual(["SIMPLEMDG_BRANCH"]);
    const written = await readPackageJson();
    expect((written.dependencies as Record<string, string>)["@simplemdg/db_common"]).toBe("uat");
  });

  it("substitutes multiple distinct *_BRANCH variables in one file", async () => {
    await writePackageJson({
      dependencies: {
        "@sap/cds": "8.5.0",
        "@simplemdg/db_common": "${SIMPLEMDG_BRANCH}",
        "@simplemdg/db_bp": "${SIMPLEMDG_DB_BRANCH}",
      },
    });

    const result = await bumpCdsPackageJson(repoPath, "9.7.2", "uat");
    expect(result.substitutedVariables.sort()).toEqual(["SIMPLEMDG_BRANCH", "SIMPLEMDG_DB_BRANCH"]);
    const written = await readPackageJson();
    expect((written.dependencies as Record<string, string>)["@simplemdg/db_bp"]).toBe("uat");
  });

  it("throws a clear, specific error for a ${VARIABLE} that isn't a *_BRANCH placeholder — never guesses a value", async () => {
    await writePackageJson({
      dependencies: { "@sap/cds": "8.5.0" },
      config: { region: "${DEPLOY_REGION}" },
    });

    await expect(bumpCdsPackageJson(repoPath, "9.7.2", "uat")).rejects.toThrow(/DEPLOY_REGION/);
  });

  it("detects @scope dependency prefixes for the npmrc-provisioning decision", async () => {
    await writePackageJson({
      dependencies: { "@sap/cds": "8.5.0", "@simplemdg/db_common": "1.2.3" },
      devDependencies: { "@simplemdg/eslint-config": "1.0.0" },
    });

    const result = await bumpCdsPackageJson(repoPath, "9.7.2", "uat");
    expect(result.scopePrefixes).toEqual(["@simplemdg"]);
  });

  it("reports an empty scopePrefixes list for a repo with no private-scope dependency", async () => {
    await writePackageJson({ dependencies: { "@sap/cds": "8.5.0", express: "^4.0.0" } });
    const result = await bumpCdsPackageJson(repoPath, "9.7.2", "uat");
    expect(result.scopePrefixes).toEqual([]);
  });

  it("applies known fixups (e.g. eslint bump) in the same pass as the version bump", async () => {
    await writePackageJson({
      dependencies: { "@sap/cds": "8.5.0" },
      devDependencies: { eslint: "^8.0.0" },
      scripts: { lint: "cds lint" },
    });

    const result = await bumpCdsPackageJson(repoPath, "9.7.2", "uat");
    expect(result.fixups.some((f) => f.id === "eslint-v9-devdependency" && f.applied)).toBe(true);
    const written = await readPackageJson();
    expect((written.devDependencies as Record<string, string>).eslint).toBe("^9");
  });
});
