import chalk from "chalk";
import { runCommand } from "../process";
import type { TCommandResult } from "../process";

/** Render a git invocation the way it would be typed in a terminal, for display before running it. */
export function gitCommandLine(args: string[]): string {
  return `git ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}`;
}

/**
 * Run a git command in `cwd`. Never throws on non-zero exit (mirrors
 * `runCommand`'s default) — callers decide how to interpret the result. When
 * `announce` is true (default), prints the command being run so the user
 * always sees exactly what git operation is about to happen (safety rule:
 * "never hide Git errors" / "always show the command").
 */
export async function runGit(
  args: string[],
  options?: { cwd?: string; announce?: boolean },
): Promise<TCommandResult> {
  if (options?.announce !== false) {
    console.log(chalk.gray(`$ ${gitCommandLine(args)}`));
  }

  return runCommand("git", args, { cwd: options?.cwd });
}

/** Run a git command and return trimmed stdout, throwing with stderr detail on failure. */
export async function runGitOrThrow(args: string[], options?: { cwd?: string; announce?: boolean }): Promise<string> {
  const result = await runGit(args, options);

  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(" ")} failed`).trim());
  }

  return result.stdout.trim();
}

/** Run a git command silently (no announce), returning the raw result without throwing. */
export async function runGitSilent(args: string[], cwd?: string): Promise<TCommandResult> {
  return runGit(args, { cwd, announce: false });
}
