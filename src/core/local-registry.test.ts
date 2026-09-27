import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findPackageNamesForVariable,
  publishLocalPackage,
  readLocalPublishRecord,
  removeLocalPublishRecord,
  resolveLocalTarballPath,
  resolveLocalVariableOption,
  toFileDependencySpecifier,
} from "./local-registry";

describe("findPackageNamesForVariable", () => {
  it("finds the dependency key whose value is exactly the variable placeholder", () => {
    const packageJsonContent = JSON.stringify({
      dependencies: {
        "@simplemdg/helper-foo": "${SIMPLEMDG_HELPER_FOO_TAG}",
        "@simplemdg/other": "1.2.3",
      },
    });

    expect(findPackageNamesForVariable(packageJsonContent, "SIMPLEMDG_HELPER_FOO_TAG")).toEqual(["@simplemdg/helper-foo"]);
  });

  it("returns an empty list when no dependency uses that variable", () => {
    const packageJsonContent = JSON.stringify({ dependencies: { "@simplemdg/other": "1.2.3" } });
    expect(findPackageNamesForVariable(packageJsonContent, "SIMPLEMDG_HELPER_FOO_TAG")).toEqual([]);
  });

  it("de-duplicates when the same variable is used for the same key twice", () => {
    const content = '{"dependencies":{"@simplemdg/a":"${VAR}"},"devDependencies":{"@simplemdg/a":"${VAR}"}}';
    expect(findPackageNamesForVariable(content, "VAR")).toEqual(["@simplemdg/a"]);
  });

  it("does not choke on a variable name containing regex-special characters", () => {
    const content = '{"dependencies":{"@simplemdg/a":"${VAR.NAME}"}}';
    expect(findPackageNamesForVariable(content, "VAR.NAME")).toEqual(["@simplemdg/a"]);
  });
});

describe("toFileDependencySpecifier", () => {
  it("converts a Windows-style path to a forward-slash file: specifier", () => {
    expect(toFileDependencySpecifier("C:\\Users\\me\\.simplemdg\\local-registry\\pkg.tgz"))
      .toBe("file:C:/Users/me/.simplemdg/local-registry/pkg.tgz");
  });
});

describe("publishLocalPackage + read/resolve/remove", () => {
  // Never let this test touch the developer's real ~/.simplemdg/local-registry
  // — point the store at a throwaway temp directory instead.
  let tempRoot: string;
  let repositoryPath: string;
  let previousRegistryRootEnv: string | undefined;
  const key = { host: "gitlab.example.com", packageId: "123", packageName: "@simplemdg/fixture-pkg" };

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smdg-local-registry-test-"));
    repositoryPath = path.join(tempRoot, "repo");
    await fs.ensureDir(repositoryPath);
    await fs.writeJson(path.join(repositoryPath, "package.json"), {
      name: "@simplemdg/fixture-pkg",
      version: "1.0.0",
    });

    previousRegistryRootEnv = process.env.SMDG_LOCAL_REGISTRY_ROOT;
    process.env.SMDG_LOCAL_REGISTRY_ROOT = path.join(tempRoot, "store");
  });

  afterEach(async () => {
    await fs.remove(tempRoot);

    if (previousRegistryRootEnv === undefined) {
      delete process.env.SMDG_LOCAL_REGISTRY_ROOT;
    } else {
      process.env.SMDG_LOCAL_REGISTRY_ROOT = previousRegistryRootEnv;
    }
  });

  // These tests shell out to a real `npm pack` (no mocking — the point is to
  // prove the tarball actually gets produced and stored), which can run well
  // past vitest's 5s default under a loaded, fully-parallel full-suite run.
  const NPM_PACK_TEST_TIMEOUT_MS = 20000;

  it("packs the repo, records metadata, and makes it resolvable", async () => {
    const result = await publishLocalPackage({ repositoryPath, host: key.host, packageId: key.packageId });

    expect(result.packageName).toBe("@simplemdg/fixture-pkg");
    expect(result.version).toBe("1.0.0");
    expect(await fs.pathExists(result.tarballPath)).toBe(true);

    const record = await readLocalPublishRecord(key);
    expect(record?.version).toBe("1.0.0");
    expect(record?.host).toBe(key.host);
    expect(record?.packageId).toBe(key.packageId);

    const tarballPath = await resolveLocalTarballPath(key);
    expect(tarballPath).toBe(result.tarballPath);
  }, NPM_PACK_TEST_TIMEOUT_MS);

  it("replaces a previous local publish under the same key instead of accumulating tarballs", async () => {
    const first = await publishLocalPackage({ repositoryPath, host: key.host, packageId: key.packageId });

    await fs.writeJson(path.join(repositoryPath, "package.json"), {
      name: "@simplemdg/fixture-pkg",
      version: "2.0.0",
    });

    const second = await publishLocalPackage({ repositoryPath, host: key.host, packageId: key.packageId });

    expect(second.version).toBe("2.0.0");
    expect(second.tarballPath).not.toBe(first.tarballPath);
    expect(await fs.pathExists(first.tarballPath)).toBe(false);
    expect(await fs.pathExists(second.tarballPath)).toBe(true);

    const record = await readLocalPublishRecord(key);
    expect(record?.version).toBe("2.0.0");
  }, NPM_PACK_TEST_TIMEOUT_MS);

  it("resolveLocalVariableOption only matches when the registry identity matches too", async () => {
    await publishLocalPackage({ repositoryPath, host: key.host, packageId: key.packageId });

    const packageJsonContent = JSON.stringify({
      dependencies: { "@simplemdg/fixture-pkg": "${SIMPLEMDG_FIXTURE_TAG}" },
    });

    const matched = await resolveLocalVariableOption({
      packageJsonContent,
      variableName: "SIMPLEMDG_FIXTURE_TAG",
      registryIdentity: { host: key.host, packageId: key.packageId },
    });
    expect(matched?.packageName).toBe("@simplemdg/fixture-pkg");

    const differentProject = await resolveLocalVariableOption({
      packageJsonContent,
      variableName: "SIMPLEMDG_FIXTURE_TAG",
      registryIdentity: { host: key.host, packageId: "999" },
    });
    expect(differentProject).toBeUndefined();

    const noIdentity = await resolveLocalVariableOption({
      packageJsonContent,
      variableName: "SIMPLEMDG_FIXTURE_TAG",
      registryIdentity: undefined,
    });
    expect(noIdentity).toBeUndefined();
  }, NPM_PACK_TEST_TIMEOUT_MS);

  it("removeLocalPublishRecord clears the entry", async () => {
    await publishLocalPackage({ repositoryPath, host: key.host, packageId: key.packageId });
    expect(await removeLocalPublishRecord(key)).toBe(true);
    expect(await readLocalPublishRecord(key)).toBeUndefined();
    expect(await removeLocalPublishRecord(key)).toBe(false);
  }, NPM_PACK_TEST_TIMEOUT_MS);
});
