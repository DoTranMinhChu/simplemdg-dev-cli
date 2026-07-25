import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TGitLabAuth } from "../gitlab/gitlab-client";
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
vi.mock("./cds-upgrade-compile", () => ({
  runCdsCompileValidation: (...args: unknown[]) => runCdsCompileValidation(...args),
}));

const mockAuth = { baseUrl: "https://gitlab.example.com", token: "t" } as unknown as TGitLabAuth;

function makeRepo(projectId: number, role: TCdsUpgradeRepoInput["role"], pathWithNamespace: string): TCdsUpgradeRepoInput {
  return { projectId, pathWithNamespace, role, defaultBranch: "main", httpUrlToRepo: `https://gitlab.example.com/${pathWithNamespace}.git` };
}

function packageJsonWithCdsVersion(version: string): string {
  return JSON.stringify({ dependencies: { "@sap/cds": version } });
}

beforeEach(() => {
  vi.clearAllMocks();
  bumpCdsPackageJson.mockResolvedValue({ changed: true, before: {}, after: {}, fixups: [] });
  runNpmInstall.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", timedOut: false });
  runCdsCompileValidation.mockResolvedValue({ ok: true, exitCode: 0, stdout: "", stderr: "", timedOut: false });
  cloneRepoAtSourceBranch.mockResolvedValue({ repoPath: "/tmp/scratch/1" });
  createAndSwitchUpgradeBranch.mockResolvedValue(undefined);
  commitAndPushBranch.mockResolvedValue(undefined);
  cleanupClone.mockResolvedValue(undefined);
  createMergeRequest.mockResolvedValue({ iid: 1, web_url: "https://gitlab.example.com/mr/1" });
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
    const result = await runCdsUpgradeJob("job-1", { auth: mockAuth, sourceBranch: "uat", targetVersion: "9.7.2", repos: [makeRepo(1, "db", "group/db")] });

    expect(result.alreadyUpToDate).toHaveLength(1);
    expect(result.upgraded).toHaveLength(0);
    expect(cloneRepoAtSourceBranch).not.toHaveBeenCalled();
  });

  it("buckets a missing branch as branchNotFound without cloning", async () => {
    fetchRawFile.mockResolvedValue(undefined);
    const result = await runCdsUpgradeJob("job-2", { auth: mockAuth, sourceBranch: "uat", targetVersion: "9.7.2", repos: [makeRepo(1, "db", "group/db")] });

    expect(result.branchNotFound).toHaveLength(1);
    expect(cloneRepoAtSourceBranch).not.toHaveBeenCalled();
  });

  it("full success path: clones, bumps, installs, compiles, commits, pushes, and opens an MR — never merges", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    const result = await runCdsUpgradeJob("job-3", { auth: mockAuth, sourceBranch: "uat", targetVersion: "9.7.2", repos: [makeRepo(1, "db", "group/db")] });

    expect(result.upgraded).toHaveLength(1);
    expect(result.upgraded[0].mergeRequestUrl).toBe("https://gitlab.example.com/mr/1");
    expect(cloneRepoAtSourceBranch).toHaveBeenCalledWith(mockAuth, expect.objectContaining({ projectId: 1 }), "uat", expect.any(String));
    expect(createAndSwitchUpgradeBranch).toHaveBeenCalledWith("/tmp/scratch/1", mockAuth, expect.stringContaining("cds-upgrade/9.7.2"));
    expect(commitAndPushBranch).toHaveBeenCalled();
    expect(createMergeRequest).toHaveBeenCalledWith(
      mockAuth,
      1,
      expect.objectContaining({ sourceBranch: expect.stringContaining("cds-upgrade/9.7.2"), targetBranch: "uat" }),
    );
    expect(cleanupClone).toHaveBeenCalledWith("/tmp/scratch/1");
  });

  it("buckets a real branch-not-found result surfaced during clone (race: deleted between check and clone)", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    cloneRepoAtSourceBranch.mockResolvedValue({ branchNotFound: true });

    const result = await runCdsUpgradeJob("job-4", { auth: mockAuth, sourceBranch: "uat", targetVersion: "9.7.2", repos: [makeRepo(1, "db", "group/db")] });
    expect(result.branchNotFound).toHaveLength(1);
    expect(commitAndPushBranch).not.toHaveBeenCalled();
  });

  it("buckets npm install failure as buildFailed and never commits/pushes/opens an MR", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    runNpmInstall.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "npm ERR! something broke", timedOut: false });

    const result = await runCdsUpgradeJob("job-5", { auth: mockAuth, sourceBranch: "uat", targetVersion: "9.7.2", repos: [makeRepo(1, "db", "group/db")] });
    expect(result.buildFailed).toHaveLength(1);
    expect(result.buildFailed[0].detail).toContain("npm ERR!");
    expect(commitAndPushBranch).not.toHaveBeenCalled();
    expect(createMergeRequest).not.toHaveBeenCalled();
    expect(cleanupClone).toHaveBeenCalled();
  });

  it("buckets cds compile failure as buildFailed with the real compiler stderr, and never commits/pushes", async () => {
    fetchRawFile.mockResolvedValue(packageJsonWithCdsVersion("8.5.0"));
    runCdsCompileValidation.mockResolvedValue({ ok: false, exitCode: 1, stdout: "", stderr: "error: unknown annotation @foo", timedOut: false });

    const result = await runCdsUpgradeJob("job-6", { auth: mockAuth, sourceBranch: "uat", targetVersion: "9.7.2", repos: [makeRepo(1, "db", "group/db")] });
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

    const result = await runCdsUpgradeJob("job-7", {
      auth: mockAuth,
      sourceBranch: "uat",
      targetVersion: "9.7.2",
      repos: [makeRepo(1, "db", "group/db-a"), makeRepo(2, "db", "group/db-b")],
    });

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].pathWithNamespace).toBe("group/db-a");
    expect(result.skipped[0].detail).toContain("network blip");
    expect(result.upgraded).toHaveLength(1);
    expect(result.upgraded[0].pathWithNamespace).toBe("group/db-b");
  });
});
