import { runCommand, splitCommand } from "../process";
import type { TGitBuildResult } from "./git-types";

export const DEFAULT_BUILD_COMMANDS = ["cds build", "npm run build", "npm test"];

export async function runBuildCommand(cwd: string, command: string): Promise<TGitBuildResult> {
  const { command: bin, args } = splitCommand(command);
  const result = await runCommand(bin, args, { cwd });

  return {
    success: result.exitCode === 0,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
