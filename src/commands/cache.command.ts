import { execa } from "execa";
import chalk from "chalk";
import { Command } from "commander";
import { searchableSelectChoice } from "../core/prompts";
import {
  CACHE_NAMESPACES,
  CACHE_SCOPES,
  clearNamespace,
  formatRelativeTime,
  getCacheDirectory,
  statNamespace,
} from "../core/cache/smart-cache";

function resolveScopeNamespaces(scope: string | undefined): string[] {
  if (!scope) {
    return CACHE_SCOPES.all;
  }

  const normalized = scope.trim().toLowerCase();

  if (CACHE_SCOPES[normalized]) {
    return CACHE_SCOPES[normalized];
  }

  if (CACHE_NAMESPACES[normalized]) {
    return [normalized];
  }

  throw new Error(`Unknown cache scope: ${scope}. Use one of: ${Object.keys(CACHE_SCOPES).join(", ")} or a namespace.`);
}

async function printCacheStatus(): Promise<void> {
  console.log(chalk.bold("SimpleMDG Cache"));
  console.log("");

  const namespaces = Object.keys(CACHE_NAMESPACES);
  const stats = await Promise.all(namespaces.map((namespace) => statNamespace(namespace)));
  const labelWidth = Math.max(...namespaces.map((namespace) => CACHE_NAMESPACES[namespace].length));

  let total = 0;

  for (const stat of stats) {
    const label = CACHE_NAMESPACES[stat.namespace].padEnd(labelWidth);
    total += stat.count;

    if (!stat.exists || stat.count === 0) {
      console.log(`${label}  ${chalk.gray("empty")}`);
      continue;
    }

    const countText = `${stat.count} item${stat.count === 1 ? "" : "s"}`.padEnd(13);
    console.log(`${label}  ${chalk.cyan(countText)} ${chalk.gray(`last updated ${formatRelativeTime(stat.lastUpdatedAt)}`)}`);
  }

  console.log("");
  console.log(chalk.gray(`${total} cached item(s) total · ${getCacheDirectory()}`));
}

async function runClear(scope: string | undefined): Promise<void> {
  const namespaces = resolveScopeNamespaces(scope);

  for (const namespace of namespaces) {
    await clearNamespace(namespace);
  }

  console.log(chalk.green(`Cleared cache: ${scope ?? "all"} (${namespaces.length} namespace(s)).`));
}

async function runRefresh(scope: string | undefined): Promise<void> {
  // "Refresh" invalidates the cache so the next command fetches live data and
  // repopulates under stale-while-revalidate. This avoids needing a live CF/
  // GitLab session inside the cache command itself.
  const namespaces = resolveScopeNamespaces(scope);

  for (const namespace of namespaces) {
    await clearNamespace(namespace);
  }

  console.log(chalk.green(`Marked for refresh: ${scope ?? "all"}. The next ${scope ?? ""} command will fetch fresh data.`));
}

async function openCacheFolder(): Promise<void> {
  const directory = getCacheDirectory();
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", directory] : [directory];
  await execa(command, args, { reject: false, detached: true, stdio: "ignore" }).catch(() => undefined);
  console.log(chalk.gray(directory));
}

async function runInteractive(): Promise<void> {
  for (;;) {
    const action = await searchableSelectChoice({
      message: "SimpleMDG cache",
      choices: [
        { title: "View cache status", value: "status" },
        { title: "Clear a cache scope", value: "clear" },
        { title: "Refresh a cache scope", value: "refresh" },
        { title: "Open cache folder", value: "open" },
        { title: "Exit", value: "exit" },
      ],
      allowCustomValue: false,
    });

    if (action === "exit") {
      return;
    }

    if (action === "status") {
      await printCacheStatus();
      console.log("");
      continue;
    }

    if (action === "open") {
      await openCacheFolder();
      console.log("");
      continue;
    }

    const scope = await searchableSelectChoice({
      message: `Select scope to ${action}`,
      choices: [
        { title: "All caches", value: "all" },
        { title: "Cloud Foundry (cf)", value: "cf" },
        { title: "GitLab", value: "gitlab" },
        { title: "Database", value: "db" },
        { title: "CF targets/favorites/recent", value: "target" },
        { title: "Dev Proxy sessions", value: "proxy" },
      ],
      allowCustomValue: false,
    });

    if (action === "clear") {
      await runClear(scope);
    } else {
      await runRefresh(scope);
    }

    console.log("");
  }
}

export function registerCacheCommands(program: Command): void {
  const cache = program
    .command("cache")
    .description("Inspect and manage the SimpleMDG smart cache (cf/gitlab/db)")
    .action(runInteractive);

  cache.command("status").description("Show cache status for all namespaces").action(printCacheStatus);

  cache
    .command("clear [scope]")
    .description("Clear cache. Scope: all | cf | gitlab | db | target | <namespace>")
    .action((scope?: string) => runClear(scope));

  cache
    .command("refresh [scope]")
    .description("Invalidate cache so the next command fetches fresh. Scope: all | cf | gitlab | db | target")
    .action((scope?: string) => runRefresh(scope));
}
