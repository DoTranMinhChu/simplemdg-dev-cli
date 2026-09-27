import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import prompts from "prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// This test drives the real interactive prompt path end to end (via
// prompts.inject, the library's own documented non-TTY test hook — see
// node_modules/prompts/lib/index.js) instead of only unit-testing the pure
// resolution helpers, to prove the actual "smdg i" selection UX works: the
// "Use local package" choice really appears/disappears at the right times
// and really produces an installable file: specifier.
//
// The cache module is mocked so this never touches the developer's real
// ~/.simplemdg/cache.json (same concern as db-cache.test.ts).
const rememberVariableValue = vi.fn(async () => undefined);
let cachedVariables: Record<string, string[]> = {};

vi.mock("./cache", () => ({
  readCache: vi.fn(async () => ({ variables: cachedVariables })),
  rememberVariableValue,
}));

const { askMissingVariables, USE_LOCAL_VALUE } = await import("./variable-prompt");
const { publishLocalPackage } = await import("./local-registry");

async function writeFixtureRepo(options: {
  repositoryPath: string;
  dependencyName: string;
  variableName: string;
  registryHost: string;
  registryPackageId: string;
}): Promise<void> {
  await fs.ensureDir(options.repositoryPath);
  await fs.writeJson(path.join(options.repositoryPath, "package.json"), {
    name: "consumer-fixture",
    version: "1.0.0",
    dependencies: {
      [options.dependencyName]: `\${${options.variableName}}`,
    },
  });
  await fs.writeFile(
    path.join(options.repositoryPath, ".npmrc"),
    [
      `@simplemdg:registry=https://${options.registryHost}/api/v4/projects/${options.registryPackageId}/packages/npm/`,
      `//${options.registryHost}/api/v4/projects/${options.registryPackageId}/packages/npm/:_authToken=dummy`,
      "always-auth=true",
    ].join("\n"),
  );
}

describe("askMissingVariables — local package selection", () => {
  let tempRoot: string;
  let previousRegistryRootEnv: string | undefined;
  const registryHost = "gitlab.example.com";
  const publishedPackageId = "555";
  const dependencyName = "@simplemdg/fixture-helper";
  const variableName = "SIMPLEMDG_FIXTURE_HELPER_TAG";

  beforeEach(() => {
    cachedVariables = {};
    rememberVariableValue.mockClear();
    previousRegistryRootEnv = process.env.SMDG_LOCAL_REGISTRY_ROOT;
    // prompts.inject() only ever concats onto its internal queue, so clear it
    // directly — otherwise a test that throws before consuming its injected
    // answer would leak it into the next test.
    (prompts as unknown as { _injected?: unknown[] })._injected = [];
  });

  afterEach(async () => {
    await fs.remove(tempRoot);

    if (previousRegistryRootEnv === undefined) {
      delete process.env.SMDG_LOCAL_REGISTRY_ROOT;
    } else {
      process.env.SMDG_LOCAL_REGISTRY_ROOT = previousRegistryRootEnv;
    }
  });

  async function setUp(consumerPackageId: string): Promise<{ repositoryPath: string }> {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "smdg-variable-prompt-test-"));
    process.env.SMDG_LOCAL_REGISTRY_ROOT = path.join(tempRoot, "store");

    const helperRepositoryPath = path.join(tempRoot, "helper");
    await fs.ensureDir(helperRepositoryPath);
    await fs.writeJson(path.join(helperRepositoryPath, "package.json"), {
      name: dependencyName,
      version: "9.9.9",
    });
    await publishLocalPackage({ repositoryPath: helperRepositoryPath, host: registryHost, packageId: publishedPackageId });

    const repositoryPath = path.join(tempRoot, "consumer");
    await writeFixtureRepo({
      repositoryPath,
      dependencyName,
      variableName,
      registryHost,
      registryPackageId: consumerPackageId,
    });

    return { repositoryPath };
  }

  it("offers 'Use local package' with no cache history yet, and selecting it yields a file: specifier without touching the value cache", async () => {
    const { repositoryPath } = await setUp(publishedPackageId);

    prompts.inject([USE_LOCAL_VALUE]);

    const result = await askMissingVariables({ repositoryPath, filePatterns: ["package.json"], providedValues: {} });

    expect(result[variableName]).toMatch(/^file:.*fixture-helper.*\.tgz$/);
    expect(rememberVariableValue).not.toHaveBeenCalled();
  }, 20000);

  it("still lets a cached real value (e.g. 'staging') be picked, unaffected by the local option", async () => {
    const { repositoryPath } = await setUp(publishedPackageId);
    cachedVariables = { [variableName]: ["staging"] };

    prompts.inject(["staging"]);

    const result = await askMissingVariables({ repositoryPath, filePatterns: ["package.json"], providedValues: {} });

    expect(result[variableName]).toBe("staging");
    expect(rememberVariableValue).toHaveBeenCalledWith(variableName, "staging");
  }, 20000);

  it("never offers the local package when the consumer's .npmrc points at a different GitLab project (collision safety)", async () => {
    const { repositoryPath } = await setUp("777"); // helper was published under 555

    // No cached values and no matching local option: the code falls straight
    // to the plain text prompt, exactly as it did before this feature existed.
    prompts.inject(["manually-typed-value"]);

    const result = await askMissingVariables({ repositoryPath, filePatterns: ["package.json"], providedValues: {} });

    expect(result[variableName]).toBe("manually-typed-value");
    expect(rememberVariableValue).toHaveBeenCalledWith(variableName, "manually-typed-value");
  }, 20000);
});
