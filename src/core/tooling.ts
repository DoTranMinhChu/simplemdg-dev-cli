import { execa } from "execa";
import chalk from "chalk";
import { searchableSelectChoice } from "./prompts";

export type TPackageManager = "winget" | "choco" | "scoop" | "brew" | "apt-get";

type TInstallStrategy =
  | { kind: "package-manager"; manager: TPackageManager; args: string[] }
  | { kind: "npm-global"; packageName: string };

type TExternalTool = {
  command: string;
  versionArgs: string[];
  displayName: string;
  docsUrl: string;
  /** Best-effort install recipes per package manager (Windows/macOS/Linux). */
  packageManagerArgs: Partial<Record<TPackageManager, string[]>>;
  /** Set when the tool ships as a global npm package. */
  npmGlobalPackage?: string;
  manualHint: string;
};

const EXTERNAL_TOOLS: Record<string, TExternalTool> = {
  cf: {
    command: "cf",
    versionArgs: ["version"],
    displayName: "Cloud Foundry CLI",
    docsUrl: "https://docs.cloudfoundry.org/cf-cli/install-go-cli.html",
    packageManagerArgs: {
      choco: ["install", "cloudfoundry-cli", "-y"],
      brew: ["install", "cloudfoundry/tap/cf-cli@8"],
    },
    manualHint: "Windows installer: https://github.com/cloudfoundry/cli/releases",
  },
  cds: {
    command: "cds",
    versionArgs: ["--version"],
    displayName: "SAP CAP CLI (@sap/cds-dk)",
    docsUrl: "https://cap.cloud.sap/docs/tools/cds-cli",
    packageManagerArgs: {},
    npmGlobalPackage: "@sap/cds-dk",
    manualHint: "Install globally with: npm install -g @sap/cds-dk",
  },
  git: {
    command: "git",
    versionArgs: ["--version"],
    displayName: "Git",
    docsUrl: "https://git-scm.com/downloads",
    packageManagerArgs: {
      winget: ["install", "-e", "--id", "Git.Git"],
      choco: ["install", "git", "-y"],
      scoop: ["install", "git"],
      brew: ["install", "git"],
      "apt-get": ["install", "-y", "git"],
    },
    manualHint: "Download Git from https://git-scm.com/downloads",
  },
};

/**
 * Check whether a command is resolvable on PATH. Uses the platform resolver
 * (`where` on Windows, `which` elsewhere) so it also finds `.cmd`/`.ps1` shims
 * (e.g. scoop, npm) without actually executing the tool.
 */
export async function isCommandAvailable(command: string): Promise<boolean> {
  const finder = process.platform === "win32" ? "where" : "which";

  try {
    const result = await execa(finder, [command], { reject: false, shell: false, timeout: 15000 });
    return !result.failed && (result.exitCode ?? 1) === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function detectAvailablePackageManagers(): Promise<TPackageManager[]> {
  const candidates: TPackageManager[] = process.platform === "win32"
    ? ["winget", "choco", "scoop"]
    : process.platform === "darwin"
      ? ["brew"]
      : ["apt-get"];

  const available: TPackageManager[] = [];

  for (const manager of candidates) {
    if (await isCommandAvailable(manager)) {
      available.push(manager);
    }
  }

  return available;
}

async function resolveInstallStrategies(tool: TExternalTool): Promise<TInstallStrategy[]> {
  const strategies: TInstallStrategy[] = [];
  const managers = await detectAvailablePackageManagers();

  for (const manager of managers) {
    const args = tool.packageManagerArgs[manager];
    if (args) {
      strategies.push({ kind: "package-manager", manager, args });
    }
  }

  if (tool.npmGlobalPackage && (await isCommandAvailable("npm"))) {
    strategies.push({ kind: "npm-global", packageName: tool.npmGlobalPackage });
  }

  return strategies;
}

function describeStrategy(strategy: TInstallStrategy): string {
  if (strategy.kind === "npm-global") {
    return `npm install -g ${strategy.packageName}`;
  }

  return `${strategy.manager} ${strategy.args.join(" ")}`;
}

async function runInstallStrategy(strategy: TInstallStrategy): Promise<number> {
  const [command, args] = strategy.kind === "npm-global"
    ? ["npm", ["install", "-g", strategy.packageName]] as const
    : [strategy.manager, strategy.args] as const;

  console.log(chalk.gray(`Running: ${command} ${args.join(" ")}`));
  const result = await execa(command, args as string[], { stdio: "inherit", reject: false, shell: false });
  return result.exitCode ?? 1;
}

function printManualInstructions(tool: TExternalTool, strategies: TInstallStrategy[]): void {
  console.log(chalk.yellow(`${tool.displayName} ('${tool.command}') is required but was not found on PATH.`));

  if (strategies.length > 0) {
    console.log("Install it with one of:");
    for (const strategy of strategies) {
      console.log(`  ${chalk.cyan(describeStrategy(strategy))}`);
    }
  }

  console.log(chalk.gray(tool.manualHint));
  console.log(chalk.gray(`Docs: ${tool.docsUrl}`));
}

/**
 * Ensure an external CLI tool is installed before a command relies on it.
 *
 * When the tool is missing, offer to install it via a detected package manager
 * (or npm for npm-backed tools). This fails fast and avoids the situation where
 * a long interactive flow only discovers a missing prerequisite at the end.
 */
export async function ensureExternalTool(toolId: keyof typeof EXTERNAL_TOOLS | string): Promise<void> {
  const tool = EXTERNAL_TOOLS[toolId];

  if (!tool) {
    return;
  }

  if (await isCommandAvailable(tool.command)) {
    return;
  }

  const strategies = await resolveInstallStrategies(tool);
  const interactive = Boolean(process.stdin.isTTY);

  if (strategies.length === 0 || !interactive) {
    printManualInstructions(tool, strategies);
    throw new Error(`${tool.displayName} is required. Install it, then re-run this command.`);
  }

  console.log(chalk.yellow(`${tool.displayName} ('${tool.command}') is not installed.`));

  const choice = await searchableSelectChoice({
    message: `Install ${tool.displayName} now?`,
    choices: [
      ...strategies.map((strategy, index) => ({
        title: `Install with ${describeStrategy(strategy)}`,
        value: String(index),
      })),
      { title: "Skip and show manual instructions", value: "__SKIP__" },
    ],
    allowCustomValue: false,
  });

  if (choice === "__SKIP__") {
    printManualInstructions(tool, strategies);
    throw new Error(`${tool.displayName} is required. Install it, then re-run this command.`);
  }

  const strategy = strategies[Number(choice)];
  const exitCode = await runInstallStrategy(strategy);

  if (exitCode !== 0) {
    console.log(chalk.red(`Install command failed (exit code ${exitCode}).`));
    printManualInstructions(tool, strategies);
    throw new Error(`Could not install ${tool.displayName} automatically.`);
  }

  if (await isCommandAvailable(tool.command)) {
    console.log(chalk.green(`${tool.displayName} is now installed.`));
    return;
  }

  // Many installers update PATH only for new shells.
  console.log(chalk.yellow(`${tool.displayName} was installed, but it is not on PATH in this session yet.`));
  console.log(chalk.gray("Open a new terminal so PATH refreshes, then re-run this command."));
  throw new Error(`${tool.displayName} install completed; restart your terminal to use it.`);
}
