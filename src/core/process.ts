import { execa } from "execa";

export type TCommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export async function runCommand(command: string, args: string[], options?: { cwd?: string; reject?: boolean; env?: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<TCommandResult> {
  const result = await execa(command, args, {
    cwd: options?.cwd,
    reject: options?.reject ?? false,
    all: false,
    shell: false,
    // Merge over process.env so callers can scope a command (e.g. an isolated
    // CF_HOME) without losing the rest of the environment.
    env: options?.env ? { ...process.env, ...options.env } : undefined,
    // execa's own cancellation hook (distinct from its `signal` option, which
    // picks the OS signal used to terminate) — lets a Ctrl+C in the
    // interactive shell actually kill a hung child process, with an escalation
    // to SIGKILL if it ignores the initial terminate signal.
    ...(options?.signal ? { cancelSignal: options.signal, forceKillAfterDelay: 5000 } : {}),
  });

  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode ?? 0,
  };
}

export async function runCommandInherit(command: string, args: string[], options?: { cwd?: string }): Promise<number> {
  const result = await execa(command, args, {
    cwd: options?.cwd,
    stdio: "inherit",
    reject: false,
    shell: false,
  });

  return result.exitCode ?? 0;
}

export function splitCommand(commandLine: string): { command: string; args: string[] } {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];

    if ((character === '"' || character === "'") && !quote) {
      quote = character;
      continue;
    }

    if (quote && character === quote) {
      quote = undefined;
      continue;
    }

    if (!quote && /\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current) {
    tokens.push(current);
  }

  const [command, ...args] = tokens;

  if (!command) {
    throw new Error("Command is required");
  }

  return { command, args };
}
