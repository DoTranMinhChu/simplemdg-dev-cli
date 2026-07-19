import { runCommand } from "../process";
import { resolveGitNexusInvocation } from "./gitnexus-runtime";

/**
 * Every GitNexus call in this domain goes through this file — the single
 * chokepoint that never throws. Callers (routes, CLI commands) get a
 * discriminated result and decide how to degrade; no GitNexus failure can
 * propagate as an uncaught exception into the rest of AI Studio.
 */
export type TGitNexusCliFailure = {
  ok: false;
  /** "setup-required" when GitNexus itself is unreachable; "error" for everything else (bad target, corrupt index, etc.) — mirrors TNexusStatus's vocabulary without importing it here to keep this file dependency-free. */
  status: "setup-required" | "error";
  message: string;
  stdout: string;
  stderr: string;
};

export type TGitNexusCliResult = { ok: true; stdout: string; stderr: string } | TGitNexusCliFailure;

function classifyFailure(command: string, detail: string): "setup-required" | "error" {
  if (command !== "npx" && /is not recognized|command not found|ENOENT/i.test(detail)) return "setup-required";
  if (/ENOTFOUND|network|fetch failed|timed? ?out|getaddrinfo|404 not found/i.test(detail)) return "setup-required";
  return "error";
}

/** Run one `gitnexus <args>` invocation. `cwd` matters when a call relies on git-root discovery (e.g. `analyze`, `status`); calls scoped with `-r <name>` work from any cwd. */
export async function runGitNexus(args: string[], options?: { cwd?: string }): Promise<TGitNexusCliResult> {
  let invocation;
  try {
    invocation = await resolveGitNexusInvocation();
  } catch (error) {
    return { ok: false, status: "setup-required", message: error instanceof Error ? error.message : String(error), stdout: "", stderr: "" };
  }

  try {
    const result = await runCommand(invocation.command, [...invocation.baseArgs, ...args], { cwd: options?.cwd });

    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).trim();
      return {
        ok: false,
        status: classifyFailure(invocation.command, detail),
        message: detail || `gitnexus ${args.join(" ")} exited with code ${result.exitCode}`,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    }

    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { ok: false, status: "error", message: error instanceof Error ? error.message : String(error), stdout: "", stderr: "" };
  }
}

export type TGitNexusJsonResult<T> = { ok: true; data: T } | TGitNexusCliFailure;

/**
 * Locates the JSON payload within stdout — most `--json`/JSON-by-default subcommands print pure
 * JSON, but some (confirmed by testing: `group query --json`) print a plain-text progress line
 * ("Searching ... across group ...") before the JSON block. Slicing from the first `{`/`[` handles
 * both cases identically and is a no-op for output that was already pure JSON.
 */
function extractJsonPayload(stdout: string): string {
  const trimmed = stdout.trim();
  const braceIndex = trimmed.indexOf("{");
  const bracketIndex = trimmed.indexOf("[");
  const candidates = [braceIndex, bracketIndex].filter((index) => index >= 0);
  if (candidates.length === 0) return trimmed;
  return trimmed.slice(Math.min(...candidates));
}

/** For the subcommands confirmed (by spike) to emit JSON on stdout: query/context/impact/cypher/check --json/group impact --json/group query --json. Never JSON.parse a GitNexus command's output anywhere else — this is the one place that assumption is allowed to live. */
export async function runGitNexusJson<T = unknown>(args: string[], options?: { cwd?: string }): Promise<TGitNexusJsonResult<T>> {
  const result = await runGitNexus(args, options);
  if (!result.ok) return result;

  try {
    return { ok: true, data: JSON.parse(extractJsonPayload(result.stdout)) as T };
  } catch {
    return {
      ok: false,
      status: "error",
      message: "GitNexus returned an unexpected response — this may indicate a version mismatch. Run `smdg ai nexus doctor`.",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
