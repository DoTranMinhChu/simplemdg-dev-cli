import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fsExtra from "fs-extra";
import { getAiSessionProviders } from "./ai-session-provider";
import { analyzeVerification, classifySessionOutcome, deriveTurns } from "./ai-session-analysis";
import { AiSessionStore } from "./ai-session-store";
import type { TIngestionResult, TParserDiagnostic, TSessionFile } from "./ai-types";

const TOOL_TYPES = new Set(["tool-call", "shell-command", "mcp-call", "skill", "subagent"]);

/**
 * Discovers session files from every provider, skips anything already ingested at its current
 * mtime+size, parses the rest, and persists them. A malformed file never stops ingestion of the
 * others — its failure is recorded as a diagnostic and the file is still marked ingested so it
 * isn't retried every run (it will be retried automatically once it changes again).
 */
export async function ingestAiSessions(store: AiSessionStore): Promise<TIngestionResult> {
  const startedAt = Date.now();
  const providers = getAiSessionProviders();
  const diagnostics: TParserDiagnostic[] = [];
  let filesDiscovered = 0;
  let filesIngested = 0;
  let filesSkippedUnchanged = 0;
  let filesFailed = 0;

  for (const provider of providers) {
    let files: TSessionFile[] = [];
    try {
      files = await provider.discoverSessionFiles();
    } catch (error) {
      diagnostics.push({
        provider: provider.id,
        sourceFile: "(discovery)",
        severity: "error",
        message: `Failed to discover session files: ${errorMessage(error)}`,
        occurredAt: new Date().toISOString(),
      });
      continue;
    }

    filesDiscovered += files.length;

    for (const file of files) {
      const existing = store.getIngestedFile(file.path);
      if (existing && existing.modifiedAtMs === file.modifiedAtMs && existing.sizeBytes === file.sizeBytes) {
        filesSkippedUnchanged += 1;
        continue;
      }

      try {
        const content = await fsExtra.readFile(file.path, "utf8");
        const parsed = provider.parseSession(file, content);
        store.clearDiagnosticsForFile(file.path);

        if (!parsed || parsed.observations.length === 0) {
          store.markFileIngested({ path: file.path, modifiedAtMs: file.modifiedAtMs, sizeBytes: file.sizeBytes, provider: provider.id, lastIngestedAt: new Date().toISOString() });
          if (!parsed) {
            const diagnostic: TParserDiagnostic = {
              provider: provider.id,
              sourceFile: file.path,
              severity: "warning",
              message: "No recognizable session id found in this file; skipped.",
              occurredAt: new Date().toISOString(),
            };
            diagnostics.push(diagnostic);
            store.addDiagnostic(diagnostic);
          }
          continue;
        }

        const turns = deriveTurns(parsed.observations);
        const toolCallCount = parsed.observations.filter((observation) => TOOL_TYPES.has(observation.type)).length;
        const errorCount = parsed.observations.filter((observation) => observation.isError).length;
        const durationMs = computeSessionDuration(parsed.session.startedAt, parsed.session.endedAt);
        const verification = analyzeVerification(parsed.observations);
        const { outcome } = classifySessionOutcome({ errorCount, verification });

        store.saveSession(parsed, { durationMs, turnCount: turns.filter((turn) => !turn.isContext).length, toolCallCount, errorCount, outcome });
        store.markFileIngested({ path: file.path, modifiedAtMs: file.modifiedAtMs, sizeBytes: file.sizeBytes, provider: provider.id, lastIngestedAt: new Date().toISOString() });
        filesIngested += 1;
      } catch (error) {
        filesFailed += 1;
        const diagnostic: TParserDiagnostic = {
          provider: provider.id,
          sourceFile: file.path,
          severity: "error",
          message: `Failed to parse: ${errorMessage(error)}`,
          occurredAt: new Date().toISOString(),
        };
        diagnostics.push(diagnostic);
        store.addDiagnostic(diagnostic);
        // Do not mark as ingested: a transient read error (file locked mid-write) should be retried
        // on the next ingestion pass rather than silently skipped forever.
      }
    }
  }

  return {
    filesDiscovered,
    filesIngested,
    filesSkippedUnchanged,
    filesFailed,
    diagnostics,
    durationMs: Date.now() - startedAt,
  };
}

function computeSessionDuration(startedAt: string, endedAt: string): number {
  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Watches every provider's session root and calls `onChange` (debounced) after any file activity. */
export function watchAiSessions(onChange: () => void): { dispose(): void } {
  const watchers: fs.FSWatcher[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 1500);
  };

  // Watch each provider's fixed root directly (rather than the files discovered so far) so a
  // brand-new session file is picked up without requiring a manual refresh first.
  const knownRoots = [path.join(os.homedir(), ".claude", "projects"), path.join(os.homedir(), ".codex", "sessions")];
  for (const root of knownRoots) {
    try {
      watchers.push(fs.watch(root, { recursive: true }, schedule));
    } catch {
      // Directory does not exist yet; ingestion still runs on manual refresh / next poll.
    }
  }

  return {
    dispose(): void {
      if (timer) clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
    },
  };
}
