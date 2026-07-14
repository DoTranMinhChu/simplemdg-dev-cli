import { Command } from "commander";
import chalk from "chalk";
import { searchableSelectChoice } from "./prompts";

const BACK_VALUE = "__SMDG_NAV_BACK__";
const EXIT_VALUE = "__SMDG_NAV_EXIT__";

// Commands that exist only for internal/background use and should never be
// offered in the interactive menu.
const INTERNAL_COMMAND_NAMES = new Set(["apps-cache-refresh", "shell"]);

export function isHidden(command: Command): boolean {
  return Boolean((command as unknown as { _hidden?: boolean })._hidden);
}

export function getNavigableChildren(command: Command): Command[] {
  return command.commands.filter((child) => {
    if (child.name() === "help") {
      return false;
    }

    if (isHidden(child)) {
      return false;
    }

    return !INTERNAL_COMMAND_NAMES.has(child.name());
  });
}

export function isGroup(command: Command): boolean {
  return getNavigableChildren(command).length > 0;
}

export function buildBreadcrumb(command: Command): string {
  const names: string[] = [];
  let current: Command | null | undefined = command;

  while (current) {
    names.unshift(current.name());
    current = current.parent;
  }

  // The bin is published as `smdg`; show that shorter name in breadcrumbs.
  if (names[0] === "simplemdg") {
    names[0] = "smdg";
  }

  return names.join(" ");
}

function buildChoiceTitle(command: Command): string {
  const aliases = command.aliases();
  const aliasText = aliases.length ? chalk.gray(` (${aliases.join(", ")})`) : "";
  const marker = isGroup(command) ? chalk.cyan(" ›") : "";
  const description = command.description();
  const descriptionText = description ? `  ${chalk.gray(`— ${description}`)}` : "";

  return `${chalk.bold(command.name())}${aliasText}${marker}${descriptionText}`;
}

export async function dispatchLeaf(leaf: Command): Promise<void> {
  console.log(chalk.gray(`→ ${buildBreadcrumb(leaf)}`));
  console.log("");
  // Parsing the leaf with no user args runs its action with default options.
  // Each leaf already prompts interactively for whatever it still needs.
  await leaf.parseAsync([], { from: "user" });
}

/**
 * Drive interactive navigation starting from a group command. Shows the list of
 * subcommands, lets the user descend into nested groups, and finally runs the
 * selected leaf command (which collects its own options interactively).
 */
export async function runGroupNavigator(startGroup: Command): Promise<void> {
  const stack: Command[] = [startGroup];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const children = getNavigableChildren(current);

    if (children.length === 0) {
      await dispatchLeaf(current);
      return;
    }

    const choices = children.map((child) => ({
      title: buildChoiceTitle(child),
      value: child.name(),
    }));

    if (stack.length > 1) {
      choices.push({ title: chalk.yellow("← Back"), value: BACK_VALUE });
    }

    choices.push({ title: chalk.gray("✕ Exit"), value: EXIT_VALUE });

    let picked: string;

    try {
      picked = await searchableSelectChoice({
        message: `${chalk.cyan(buildBreadcrumb(current))} — type to filter, then select`,
        choices,
        allowCustomValue: false,
        limit: 20,
      });
    } catch {
      // ESC / cancel: step back one level, or exit when at the top.
      if (stack.length > 1) {
        stack.pop();
        continue;
      }

      return;
    }

    if (picked === EXIT_VALUE) {
      return;
    }

    if (picked === BACK_VALUE) {
      stack.pop();
      continue;
    }

    const selected = children.find((child) => child.name() === picked);

    if (!selected) {
      return;
    }

    if (isGroup(selected)) {
      stack.push(selected);
      continue;
    }

    await dispatchLeaf(selected);
    return;
  }
}

/**
 * Attach the interactive navigator to every group command in the tree. After
 * this, invoking a group without a subcommand (e.g. `smdg cf` or `smdg cf db`)
 * opens a searchable menu of its subcommands instead of printing help.
 *
 * Leaf commands keep their own action handlers untouched. Existing default
 * actions on group commands are replaced by the navigator so navigation stays
 * consistent across the whole CLI.
 */
export function enableInteractiveNavigation(program: Command): void {
  const attach = (command: Command): void => {
    for (const child of command.commands) {
      if (isGroup(child)) {
        child.action(async () => {
          await runGroupNavigator(child);
        });
      }

      attach(child);
    }
  };

  attach(program);
}
