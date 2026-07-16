import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execa } from "execa";
import prompts from "prompts";
import chalk from "chalk";
import { Command } from "commander";
import { searchableSelectChoice } from "../core/prompts";
import { openBrowser } from "../core/studio-shared/studio-server-kit";
import { formatRelativeTime } from "../core/cache/smart-cache";
import {
  listProjects as listProjectsFromClient,
  listRootGroups as listRootGroupsFromClient,
  normalizeBaseUrl,
  readGitLabCache,
  saveAuth,
  validateToken,
  writeGitLabCache,
} from "../core/gitlab/gitlab-client";
import type { TGitLabAuth, TGitLabGroup, TGitLabProject } from "../core/gitlab/gitlab-client";

async function readClipboard(): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  const result = await execa("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { reject: false });
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

async function askAuth(): Promise<TGitLabAuth> {
  const cache = await readGitLabCache();
  if (cache.instances.length) {
    const selected = await searchableSelectChoice({
      message: "Select GitLab instance",
      choices: [
        ...cache.instances.map((item, index) => ({ title: `${item.username ?? "user"} · ${item.baseUrl} · logged in`, value: String(index) })),
        { title: "Login to another GitLab instance", value: "new" },
      ],
      allowCustomValue: false,
    });
    if (selected !== "new") return cache.instances[Number(selected)];
  }
  return await runLoginFlow();
}

async function runLoginFlow(): Promise<TGitLabAuth> {
  const baseResponse = await prompts({ type: "text", name: "baseUrl", message: "GitLab base URL", initial: "https://gitlab.simplemdg.com" });
  const baseUrl = normalizeBaseUrl(baseResponse.baseUrl || "https://gitlab.simplemdg.com");
  const mode = await searchableSelectChoice({
    message: "GitLab login method",
    choices: [
      { title: "Open token page and auto-detect from clipboard", value: "clipboard" },
      { title: "Paste token manually", value: "manual" },
    ],
    allowCustomValue: false,
  });
  let token = "";
  if (mode === "clipboard") {
    const tokenUrl = `${baseUrl}/-/user_settings/personal_access_tokens?name=SimpleMDG%20CLI&scopes=api,read_repository,write_repository`;
    console.log(chalk.gray(`Opening: ${tokenUrl}`));
    await openBrowser(tokenUrl);
    console.log(chalk.yellow("Create/copy the token in GitLab. The CLI will read clipboard, then fallback to manual input."));
    for (let i = 0; i < 60; i += 1) {
      const value = await readClipboard();
      if (value && /^(glpat-|gloas-|glcbt-|[A-Za-z0-9_\-]{20,})/.test(value)) { token = value; break; }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!token) {
    const response = await prompts({ type: "password", name: "token", message: "GitLab token" });
    token = String(response.token ?? "").trim();
  }
  if (!token) throw new Error("GitLab token is required");
  const auth = await validateToken(baseUrl, token);
  await saveAuth(auth);
  console.log(chalk.green(`Logged in: ${auth.username ?? auth.name ?? "GitLab user"} · ${auth.baseUrl}`));
  return auth;
}

async function listRootGroups(auth: TGitLabAuth, refresh: boolean, notify = false): Promise<TGitLabGroup[]> {
  const result = await listRootGroupsFromClient(auth, refresh);

  if (notify && result.fromCache) {
    console.log(chalk.gray(`Using ${result.data.length} cached GitLab groups from ${formatRelativeTime(result.updatedAt)}.${result.isRefreshing ? " Refreshing in background..." : ""}`));
  }
  if (notify && result.refreshPromise) {
    result.refreshPromise.then(() => console.log(chalk.gray("GitLab groups cache updated."))).catch(() => console.log(chalk.yellow("GitLab groups refresh failed; using cached list.")));
  }

  return result.data;
}

async function askGroup(auth: TGitLabAuth, refresh?: boolean): Promise<TGitLabGroup> {
  const groups = await listRootGroups(auth, !!refresh);
  if (!groups.length) throw new Error("No GitLab root groups found for this account.");
  const selected = await searchableSelectChoice({
    message: "Search/select GitLab root group",
    choices: groups.map((group) => ({ title: `${group.full_path} · #${group.id} · ${group.visibility ?? ""}`, value: String(group.id) })),
    allowCustomValue: false,
  });
  const group = groups.find((item) => String(item.id) === selected);
  if (!group) throw new Error("Group not found");
  return group;
}

async function listProjects(auth: TGitLabAuth, group: TGitLabGroup, refresh: boolean, notify = false): Promise<TGitLabProject[]> {
  const result = await listProjectsFromClient(auth, group, refresh);

  if (notify && result.fromCache) {
    console.log(chalk.gray(`Using ${result.data.length} cached projects in ${group.full_path} from ${formatRelativeTime(result.updatedAt)}.${result.isRefreshing ? " Refreshing in background..." : ""}`));
  }
  if (notify && result.refreshPromise) {
    result.refreshPromise.then(() => console.log(chalk.gray("GitLab projects cache updated."))).catch(() => console.log(chalk.yellow("GitLab projects refresh failed; using cached list.")));
  }

  return result.data;
}

function localProjectPath(destination: string, project: TGitLabProject): string {
  return path.resolve(destination, project.path_with_namespace.replace(/\//g, path.sep));
}

function gitEnv(auth: TGitLabAuth): NodeJS.ProcessEnv {
  const askPass = path.join(os.tmpdir(), `smdg-git-askpass-${crypto.randomBytes(6).toString("hex")}${process.platform === "win32" ? ".cmd" : ".sh"}`);
  if (process.platform === "win32") {
    fs.writeFileSync(askPass, `@echo off\r\necho %SMDG_GIT_ASKPASS_VALUE%\r\n`);
  } else {
    fs.writeFileSync(askPass, `#!/bin/sh\nprintf '%s\\n' "$SMDG_GIT_ASKPASS_VALUE"\n`);
    fs.chmodSync(askPass, 0o700);
  }
  return { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: askPass, SMDG_GIT_ASKPASS_VALUE: auth.token };
}

async function runGit(repoPath: string | undefined, args: string[], auth: TGitLabAuth): Promise<{ ok: boolean; output: string }> {
  const result = await execa("git", args, { cwd: repoPath, reject: false, env: gitEnv(auth) });
  return { ok: (result.exitCode ?? 0) === 0, output: [result.stdout, result.stderr].filter(Boolean).join("\n") };
}

async function cloneOrUpdateProject(project: TGitLabProject, destination: string, action: string, auth: TGitLabAuth): Promise<void> {
  const repoPath = localProjectPath(destination, project);
  await fs.ensureDir(path.dirname(repoPath));
  if (!(await fs.pathExists(path.join(repoPath, ".git")))) {
    const clone = await runGit(undefined, ["clone", project.http_url_to_repo, repoPath], auth);
    if (!clone.ok) throw new Error(clone.output);
  } else {
    await runGit(repoPath, ["fetch", "--all", "--prune", "--tags"], auth);
  }

  if (action === "fetch") return;
  if (action === "pull-current") {
    const pull = await runGit(repoPath, ["pull", "--ff-only"], auth);
    if (!pull.ok) throw new Error(pull.output);
    return;
  }

  if (action === "pull-all") {
    const original = await runGit(repoPath, ["branch", "--show-current"], auth);
    const refs = await runGit(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], auth);
    if (!refs.ok) throw new Error(refs.output);
    const branches = refs.output.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("origin/"))
      .map((line) => line.replace(/^origin\//, ""))
      .filter((name) => name && !["HEAD", "origin"].includes(name));
    for (const branch of branches) {
      const localExists = await runGit(repoPath, ["show-ref", "--verify", `refs/heads/${branch}`], auth);
      const switchArgs = localExists.ok ? ["switch", branch] : ["switch", "-c", branch, "--track", `origin/${branch}`];
      const sw = await runGit(repoPath, switchArgs, auth);
      if (sw.ok) await runGit(repoPath, ["pull", "--ff-only"], auth);
    }
    const restore = original.output.trim() || project.default_branch || "main";
    await runGit(repoPath, ["switch", restore], auth);
  }
}

async function parallelRun<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  let done = 0;
  let failed = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      try { await worker(items[index], index); }
      catch (error) { failed += 1; console.error(chalk.red(`[${index + 1}/${items.length}] FAIL ${error instanceof Error ? error.message : error}`)); }
      finally { done += 1; process.stdout.write(chalk.gray(`\rProgress ${done}/${items.length} · failed ${failed}`)); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  process.stdout.write("\n");
}

async function runSync(options: { refresh?: boolean }): Promise<void> {
  const auth = await askAuth();
  const mode = await searchableSelectChoice({
    message: "What do you want to pull/clone?",
    choices: [
      { title: "Pull/clone a GitLab group", value: "group" },
      { title: "Pull/clone a single repository", value: "repo" },
    ],
    allowCustomValue: false,
  });
  const group = await askGroup(auth, options.refresh);
  const projects = await listProjects(auth, group, !!options.refresh);
  let selectedProjects: TGitLabProject[] = projects;

  if (mode === "repo") {
    const selectedProjectId = await searchableSelectChoice({
      message: "Search/select GitLab repository",
      choices: projects.map((project) => ({ title: `${project.path_with_namespace} · #${project.id}`, value: String(project.id) })),
      allowCustomValue: false,
    });
    selectedProjects = projects.filter((project) => String(project.id) === selectedProjectId);
  }

  const dest = await prompts({ type: "text", name: "value", message: "Destination folder", initial: "." });
  const action = await searchableSelectChoice({
    message: "Sync action",
    choices: [
      { title: "Clone missing repos and fetch existing repos", value: "fetch" },
      { title: "Pull current branch only", value: "pull-current" },
      { title: "Pull all remote branches locally", value: "pull-all" },
    ],
    allowCustomValue: false,
  });
  const jobValue = await searchableSelectChoice({
    message: "Parallel jobs",
    choices: ["4", "2", "6", "8"].map((value) => ({ title: `${value} parallel jobs`, value })),
    allowCustomValue: true,
  });
  const concurrency = Math.max(1, Math.min(16, Number(jobValue) || 4));
  const destination = path.resolve(String(dest.value || "."));
  const cache = await readGitLabCache();
  cache.destinations = [destination, ...cache.destinations.filter((item) => item !== destination)].slice(0, 20);
  await writeGitLabCache(cache);

  console.log(chalk.cyan(`Syncing ${selectedProjects.length} repo(s) with ${concurrency} job(s)...`));
  await parallelRun(selectedProjects, concurrency, async (project, index) => {
    console.log(chalk.blue(`\n[${index + 1}/${selectedProjects.length}] RUN  ${project.path_with_namespace}`));
    await cloneOrUpdateProject(project, destination, action, auth);
    console.log(chalk.green(`[${index + 1}/${selectedProjects.length}] DONE ${project.path_with_namespace}`));
  });
}

export function registerGitLabCommands(program: Command): void {
  const gitlab = program.command("gitlab").alias("gl").description("GitLab browser login, group/project scan, clone, sync, and branch fetch helpers");
  gitlab.command("login").description("Login to GitLab and cache auth").action(async () => { await runLoginFlow(); });
  gitlab.command("auth-status").alias("whoami").description("Show cached GitLab auth status").action(async () => {
    const cache = await readGitLabCache();
    if (!cache.instances.length) { console.log("Not logged in."); return; }
    for (const auth of cache.instances) console.log(`${auth.baseUrl} · ${auth.username ?? "user"} · expires ${auth.expiresAt ?? "unknown"}`);
  });
  gitlab.command("logout").description("Remove cached GitLab login").action(async () => { const cache = await readGitLabCache(); cache.instances = []; await writeGitLabCache(cache); console.log("GitLab login cache cleared."); });
  gitlab.command("groups").description("List GitLab root groups").option("--refresh", "Refresh from API").action(async (options: { refresh?: boolean }) => {
    const auth = await askAuth();
    const groups = await listRootGroups(auth, !!options.refresh, true);
    for (const group of groups) console.log(`${group.full_path} · #${group.id} · ${group.visibility ?? ""}`);
  });
  gitlab.command("projects").description("List projects in a GitLab root group").option("--refresh", "Refresh from API").action(async (options: { refresh?: boolean }) => {
    const auth = await askAuth();
    const group = await askGroup(auth, options.refresh);
    const projects = await listProjects(auth, group, !!options.refresh, true);
    for (const project of projects) console.log(`${project.path_with_namespace} · #${project.id}`);
  });
  gitlab.command("sync").alias("clone").description("Clone or update GitLab projects without ghorg").option("--refresh", "Refresh groups/projects from API").action(runSync);
  gitlab.command("pull").description("Interactive pull/fetch for GitLab projects").option("--refresh", "Refresh groups/projects from API").action(runSync);
}
