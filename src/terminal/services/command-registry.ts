import type { Command } from "commander";
import { getNavigableChildren, isGroup } from "../../core/navigator";
import { CATEGORY_LABELS, COMMAND_METADATA } from "./command-registry-metadata";

export type TInteractiveCommandDefinition = {
  id: string;
  path: string[];
  title: string;
  description: string;
  category: string;
  aliases: string[];
  keywords: string[];
  icon?: string;
  /** The live Commander leaf — traditional dispatch (`parseAsync([], {from:"user"})`) runs this directly. */
  command: Command;
};

function buildPath(command: Command): string[] {
  const names: string[] = [];
  let current: Command | null | undefined = command;

  while (current && current.parent) {
    names.unshift(current.name());
    current = current.parent;
  }

  return names;
}

function collectLeaves(command: Command, acc: Command[]): void {
  const children = getNavigableChildren(command);

  if (children.length === 0) {
    if (command.parent) {
      acc.push(command);
    }
    return;
  }

  for (const child of children) {
    if (isGroup(child)) {
      collectLeaves(child, acc);
    } else {
      acc.push(child);
    }
  }
}

/**
 * Derives the palette/help data straight from the live Commander tree — name,
 * description, and aliases are single-sourced from Commander itself. Only
 * category/icon/natural-language keywords come from the small hand-authored
 * overlay in command-registry-metadata.ts. This is what keeps the slash
 * palette and `--help` output from ever drifting apart.
 */
export function buildCommandRegistry(program: Command): TInteractiveCommandDefinition[] {
  const leaves: Command[] = [];
  collectLeaves(program, leaves);

  return leaves.map((leaf) => {
    const path = buildPath(leaf);
    const id = path.join(".");
    const overlay = COMMAND_METADATA[id];
    const category = overlay?.category ?? CATEGORY_LABELS[path[0]] ?? "General";

    return {
      id,
      path,
      title: path.join(" "),
      description: leaf.description() || "",
      category,
      aliases: leaf.aliases(),
      keywords: overlay?.keywords ?? [],
      icon: overlay?.icon,
      command: leaf,
    };
  });
}
