import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TGitLabAuth, TGitLabGroup } from "../gitlab/gitlab-client";
import { previewCdsUpgrade, runCdsUpgradeJob } from "./cds-upgrade-job";
import type { TCdsUpgradeRepoInput } from "./cds-upgrade-job";

const fetchRawFile = vi.fn();
vi.mock("../gitlab/gitlab-client", () => ({
  fetchRawFile: (...args: unknown[]) => fetchRawFile(...args),
}));

const createMergeRequest = vi.fn();
vi.mock("../gitlab/gitlab-write-client", () => ({
  createMergeRequest: (...args: unknown[]) => createMergeRequest(...args),
}));

const cloneRepoAtSourceBranch = vi.fn();
const createAndSwitchUpgradeBranch = vi.fn();
const commitAndPushBranch = vi.fn();
const cleanupClone = vi.fn();
vi.mock("./cds-upgrade-clone", () => ({
  cloneRepoAtSourceBranch: (...args: unknown[]) => cloneRepoAtSourceBranch(...args),
  createAndSwitchUpgradeBranch: (...args: unknown[]) => createAndSwitchUpgradeBranch(...args),
  commitAndPushBranch: (...args: unknown[]) => commitAndPushBranch(...args),
  cleanupClone: (...args: unknown[]) => cleanupClone(...args),
}));

const bumpCdsPackageJson = vi.fn();
const runNpmInstall = vi.fn();
vi.mock("./cds-upgrade-install", () => ({
  bumpCdsPackageJson: (...args: unknown[]) => bumpCdsPackageJson(...args),
  runNpmInstall: (...args: unknown[]) => runNpmInstall(...args),
}));

const runCdsCompileValidation = vi.fn();
const hasCompilableModel = vi.fn();
vi.mock("./cds-upgrade-compile", () => ({
  runCdsCompileValidation: (...args: unknown[]) => runCdsCompileValidation(...args),
  hasCompilableModel: (...args: unknown[]) => hasCompilableModel(...args),
}));

const resolveNpmrcAuthForGroup = vi.fn();
const writeScopedNpmrc = vi.fn();
vi.mock("./cds-upgrade-npmrc", () => ({
  resolveNpmrcAuthForGroup: (...args: unknown[]) => resolveNpmrcAuthForGroup(...args),
  writeScopedNpmrc: (...args: unknown[]) => writeScopedNpmrc(...args),
}));

const mockAuth = { baseUrl: "https://gitlab.example.com", token: "t" } as unknown as TGitLabAuth;
const mockGroup: TGitLabGroup = { id: 1, full_path: "group", name: "group" };

function makeRepo(projectId: number, role: TCdsUpgradeRepoInput["role"], pathWithNamespace: string): TCdsUpgradeRepoInput {
  return { projectId, pathWithNamespace, role, defaultBranch: "main", httpUrlToRepo: `https://gitlab.example.com/${pathWithNamespace}.git` };
}

function packageJsonWithCdsVersion(version: string): string {
  return JSON.stringify({ dependencies: { "@sap/cds": version } });
}

function runJob(jobId: string, overrides: Partial<Parameters<typeof runCdsUpgradeJob>[1]> & { repos: TCdsUpgradeRepoInput[] }) {
  return runCdsUpgradeJob(jobId, { auth: mockAuth, group: mockGroup, sourceBranch: "uat", targetVersion: "9.7.2", ...overrides });
}

beforeEach(() => {
  vi.clearAllMocks();
  bumpCdsPackageJson.mockResolvedValue({ changed: true, before: {}, after: {}, fixups: [], substitutedVariables: [], scopePrefixes: [] });
  runNpmInstall.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
  hasCompilableModel.mockResolvedValue(true);
  runCdsCompileValidation.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false });
  cloneRepoAtSourceBranch.mockResolvedValue({ repoPath: "/tmp/scratch/1" });
  createAndSwitchUpgradeBranch.mockResolvedValue(undefined);
  commitAndPushBranch.mockResolvedValue(undefined);
  cleanupClone.mockResolvedValue(undefined);
  createMergeRequest.mockResolvedValue({ iid: 1, web_url: "https://gitlab.example.com/mr/1" });
  resolveNpmrcAuthForGroup.mockResolvedValue({ host: "gitlab.example.com", packageId: "82468", token: "tok" });
  writeScopedNpmrc.mockResolvedValue(undefined);
});

describe("previewCdsUpgrade", () => {
  it("buckets repos without ever touching clone/install/compile", async () => {
    fetchRawFile.mockImplementation(async (_auth: unknown, projectId: number) => {
      if (projectId === 1) return packageJsonWithCdsVersion("8.5.0");
      if (projectId === 2) return packageJsonWithCdsVersion("9.9.0");
      return undefined;
    });

    const repos = [makeRepo(1, "db", "group/simplemdg_db_bp"), makeRepo(2, "srv", "group/simplemdg_srv_bp"), makeRepo(3, "db", "group/simplemdg_db_missing")];
    const rows = await previewCdsUpgrade(mockAuth, "uat", "9.7.2", repos);

    expect(rows).toEqual([
      { role: "db", pathWithNamespace: "group/simplemdg_db_bp", projectId: 1, bucket: "wouldUpgrade", currentVersion: "8.5.0" },
      { role: "srv", pathWithNamespace: "group/simplemdg_srv_bp", projectId: 2, bucket: "alreadyUpToDate", currentVersion: "9.9.0" },
      { role: "db", pathWithNamespace: "group/simplemdg_db_missing", projectId: 3, bucket: "branchNotFound" },
    ]);
    expect(cloneRepoAtSourceBranch).not.toHaveBeenCalled();
    expect(runNpmInstall).not.toHaveBeenCalled();
  });
});

describe("runCdsUpgradeJob", () => {
  it("skips a repo already at/above the target version without cloning it", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("9.9.0"));
    const result = await runJob("job-1", { repos: [makeRepo(1, "db", "group/db")] });

    expect(result.alreadyUpToDate).toHaveLength(1);
    expect(result.upgraded).toHaveLength(0);
    expect(cloneRepoAtSourceBranch).not.toHaveBeenCalled();
  });

  it("buckets a missing branch as branchNotFound without cloning", async () => {
    fetchRawFile.mockResolvedValue(undefined);
    const result = await runJob("job-2", { repos: [makeRepo(1, "db", "group/db")] });

    expect(result.branchNotFound).toHaveLength(1);
    expect(cloneRepoAtSourceBranch).not.toHaveBeenCalled();
  });

  it("full success path: clones, bumps, installs, compiles, commits, pushes, and opens an MR — never merges", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    const result = await runJob("job-3", { repos: [makeRepo(1, "db", "group/db")] });

    expect(result.upgraded).toHaveLength(1);
    expect(result.upgraded[0].mergeRequestUrl).toBe("https://gitlab.example.com/mr/1");
    expect(bumpCdsPackageJson).toHaveBeenCalledWith("/tmp/scratch/1", "9.7.2", "uat");
    expect(cloneRepoAtSourceBranch).toHaveBeenCalledWith(mockAuth, expect.objectContaining({ projectId: 1 }), "uat", expect.any(String));
    expect(createAndSwitchUpgradeBranch).toHaveBeenCalledWith("/tmp/scratch/1", mockAuth, expect.stringContaining("cds-upgrade/9.7.2"));
    expect(commitAndPushBranch).toHaveBeenCalled();
    expect(createMergeRequest).toHaveBeenCalledWith(
      mockAuth,
      1,
      expect.objectContaining({ sourceBranch: expect.stringContaining("cds-upgrade/9.7.2"), targetBranch: "uat" }),
    );
    expect(cleanupClone).toHaveBeenCalledWith("/tmp/scratch/1");
    // No scoped dependency detected (default mock) — never touches the npmrc/registry machinery.
    expect(resolveNpmrcAuthForGroup).not.toHaveBeenCalled();
    expect(writeScopedNpmrc).not.toHaveBeenCalled();
  });

  it("buckets a real branch-not-found result surfaced during clone (race: deleted between check and clone)", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    cloneRepoAtSourceBranch.mockResolvedValue({ branchNotFound: true });

    const result = await runJob("job-4", { repos: [makeRepo(1, "db", "group/db")] });
    expect(result.branchNotFound).toHaveLength(1);
    expect(commitAndPushBranch).not.toHaveBeenCalled();
  });

  it("buckets npm install failure as buildFailed and never commits/pushes/opens an MR", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    runNpmInstall.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "npm ERR! something broke", timedOut: false });

    const result = await runJob("job-5", { repos: [makeRepo(1, "db", "group/db")] });
    expect(result.buildFailed).toHaveLength(1);
    expect(result.buildFailed[0].detail).toContain("npm ERR!");
    expect(commitAndPushBranch).not.toHaveBeenCalled();
    expect(createMergeRequest).not.toHaveBeenCalled();
    expect(cleanupClone).toHaveBeenCalled();
  });

  it("buckets cds compile failure as buildFailed with the real compiler stderr, and never commits/pushes", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    runCdsCompileValidation.mockResolvedValue({ ok: false, exitCode: 1, stdout: "", stderr: "error: unknown annotation @foo", timedOut: false });

    const result = await runJob("job-6", { repos: [makeRepo(1, "db", "group/db")] });
    expect(result.buildFailed).toHaveLength(1);
    expect(result.buildFailed[0].detail).toContain("unknown annotation @foo");
    expect(commitAndPushBranch).not.toHaveBeenCalled();
  });

  it("isolates one repo's unexpected failure from the rest of the batch", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    cloneRepoAtSourceBranch.mockImplementation(async (_auth: unknown, project: { projectId: number }) => {
      if (project.projectId === 1) throw new Error("network blip");
      return { repoPath: `/tmp/scratch/${project.projectId}` };
    });

    const result = await runJob("job-7", { repos: [makeRepo(1, "db", "group/db-a"), makeRepo(2, "db", "group/db-b")] });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].pathWithNamespace).toBe("group/db-a");
    expect(result.skipped[0].detail).toContain("network blip");
    expect(result.upgraded).toHaveLength(1);
    expect(result.upgraded[0].pathWithNamespace).toBe("group/db-b");
  });

  it("skips cds compile (not a failure) when the repo has no compilable model for its role, e.g. an F4-style external-archive-only db repo", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    hasCompilableModel.mockResolvedValue(false);

    const result = await runJob("job-8", { repos: [makeRepo(1, "db", "group/simplemdg_db_f4")] });

    expect(runCdsCompileValidation).not.toHaveBeenCalled();
    expect(result.upgraded).toHaveLength(1);
    expect(result.upgraded[0].detail).toContain("compile validation skipped");
    expect(commitAndPushBranch).toHaveBeenCalled();
  });

  it("writes a scoped .npmrc OUTSIDE the clone and passes it to npm install when the repo references a private scope", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    bumpCdsPackageJson.mockResolvedValue({ changed: true, before: {}, after: {}, fixups: [], substitutedVariables: ["SIMPLEMDG_BRANCH"], scopePrefixes: ["@simplemdg"] });

    const result = await runJob("job-9", { repos: [makeRepo(1, "db", "group/simplemdg_db_bp")] });

    expect(resolveNpmrcAuthForGroup).toHaveBeenCalledWith(mockAuth, mockGroup, "@simplemdg");
    expect(writeScopedNpmrc).toHaveBeenCalledWith(expect.not.stringContaining("/tmp/scratch/1"), expect.any(Object), "@simplemdg");
    const npmrcPathUsed = runNpmInstall.mock.calls[0][1]?.npmrcPath;
    expect(typeof npmrcPathUsed).toBe("string");
    expect(npmrcPathUsed).not.toContain("/tmp/scratch/1"); // never inside the git clone itself
    expect(result.upgraded).toHaveLength(1);
  });

  it("buckets as skipped (not buildFailed) with a clear message when a private scope is detected but no registry/token is configured", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    bumpCdsPackageJson.mockResolvedValue({ changed: true, before: {}, after: {}, fixups: [], substitutedVariables: [], scopePrefixes: ["@simplemdg"] });
    resolveNpmrcAuthForGroup.mockResolvedValue(undefined);

    const result = await runJob("job-10", { repos: [makeRepo(1, "db", "group/simplemdg_db_bp")] });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].detail).toContain("@simplemdg");
    expect(runNpmInstall).not.toHaveBeenCalled();
    expect(commitAndPushBranch).not.toHaveBeenCalled();
  });
});
