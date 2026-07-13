import chalk from "chalk";
import { Command } from "commander";
import { searchableSelectChoice } from "../core/prompts";
import { analyzeSession, deriveTurns } from "../core/ai/ai-session-analysis";
import { ingestAiSessions } from "../core/ai/ai-session-ingestion";
import { AiSessionStore, aiStudioStorageDir } from "../core/ai/ai-session-store";
import { startAiStudioServer } from "../core/ai/studio/ai-studio-server";
import type { TAiSession } from "../core/ai/ai-types";

async function openStoreOrExit(): Promise<AiSessionStore> {
  const store = await AiSessionStore.open();
  if (!store) {
    console.error(chalk.red("AI Studio requires Node.js 22.5+ for its local SQLite store (node:sqlite)."));
    console.error(chalk.gray(`You are running ${process.version}. Upgrade Node.js and try again.`));
    process.exit(1);
  }
  return store;
}

function formatDuration(ms: number): string {
  if (!ms) return "0s";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds < 10 ? "0" : ""}${seconds}s` : `${seconds}s`;
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${Math.round(count / 1000)}K`;
  return String(count);
}

function statusLabel(session: TAiSession): string {
  if (session.errorCount > 0) return chalk.yellow("PARTIAL");
  return chalk.green("SUCCESS");
}

async function runStudioCommand(options: { port?: string; devUi?: boolean; apiOnly?: boolean }): Promise<void> {
  const apiOnly = Boolean(options.apiOnly || options.devUi);
  const handle = await startAiStudioServer({ port: options.port ? Number(options.port) : undefined, apiOnly });
  if (options.devUi) {
    console.log(chalk.gray("Running in --dev-ui mode. In another terminal:"));
    console.log(chalk.cyan("  cd studio && npm run dev"));
    console.log(chalk.gray(`Then open the Vite dev URL; it proxies /api/* to ${handle.url}.`));
  }
  await new Promise(() => undefined); // Keep the process alive until Ctrl+C.
}

async function runSessionsCommand(options: { provider?: string; project?: string; limit?: string }): Promise<void> {
  const store = await openStoreOrExit();
  await ingestAiSessions(store);
  const { sessions } = store.listSessions({
    filter: { provider: options.provider, project: options.project },
    limit: options.limit ? Number(options.limit) : 20,
  });
  store.close();

  if (!sessions.length) {
    console.log("No AI sessions found yet. Use Claude Code or Codex, then re-run this command.");
    return;
  }

  console.log("");
  console.log(chalk.bold("Recent AI sessions"));
  console.log("");
  for (const session of sessions) {
    const provider = session.provider === "claude" ? "Claude" : session.provider === "codex" ? "Codex" : session.provider;
    console.log(
      `${statusLabel(session).padEnd(18)} ${provider.padEnd(10)} ${session.project.slice(0, 28).padEnd(28)} ${formatDuration(session.durationMs).padEnd(9)} ${formatTokens(
        session.inputTokens + session.outputTokens,
      )}`,
    );
    console.log(chalk.gray(`  ${session.id}  ${session.title.slice(0, 90)}`));
  }
  console.log("");
  console.log(chalk.gray(`Run "smdg ai inspect <session-id>" for details, or "smdg ai studio" for the full browser UI.`));
}

async function pickSessionInteractively(store: AiSessionStore): Promise<string | undefined> {
  const { sessions } = store.listSessions({ limit: 25 });
  if (!sessions.length) return undefined;
  try {
    return await searchableSelectChoice({
      message: "Select a session",
      choices: sessions.map((session) => ({ title: `${session.project} — ${session.title.slice(0, 70)}`, value: session.id })),
      allowCustomValue: false,
    });
  } catch {
    return undefined;
  }
}

async function runInspectCommand(sessionIdArg: string | undefined): Promise<void> {
  const store = await openStoreOrExit();
  await ingestAiSessions(store);

  const sessionId = sessionIdArg ?? (await pickSessionInteractively(store));
  if (!sessionId) {
    console.log("No AI sessions found yet.");
    store.close();
    return;
  }

  const session = store.getSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    store.close();
    process.exitCode = 1;
    return;
  }

  const observations = store.getObservations(sessionId);
  const analysis = analyzeSession(sessionId, observations);
  store.close();

  console.log("");
  console.log(chalk.bold(session.title));
  console.log("");
  console.log(`Provider:  ${session.provider}`);
  console.log(`Project:   ${session.project}`);
  console.log(`Model:     ${session.model || "unknown"}`);
  console.log(`Duration:  ${formatDuration(session.durationMs)}`);
  console.log(`Tokens:    ${formatTokens(session.inputTokens + session.outputTokens)} (cache-read ${formatTokens(session.cacheReadTokens)})`);
  console.log(`Tools:     ${session.toolCallCount}`);
  console.log(`Errors:    ${session.errorCount}`);
  console.log(`Files:     ${analysis.fileImpact.length} touched`);
  console.log("");
  console.log(chalk.bold("Verification:"));
  if (!analysis.verification.length) {
    console.log("  (none observed)");
  } else {
    for (const check of analysis.verification) {
      const icon = check.status === "pass" ? chalk.green("✓") : check.status === "fail" ? chalk.red("✗") : chalk.yellow("?");
      console.log(`  ${icon} ${check.label}`);
    }
  }
  console.log("");
  console.log(chalk.bold(`Outcome: ${labelOutcome(analysis.outcome)}`));
  for (const evidence of analysis.outcomeEvidence) console.log(`  - ${evidence}`);
  if (analysis.errorGroups.length) {
    console.log("");
    console.log(chalk.bold("Top risk:"));
    console.log(`  ${analysis.errorGroups[0].category} — ${analysis.errorGroups[0].message.slice(0, 100)} (${analysis.errorGroups[0].count}x)`);
  }
  console.log("");
}

function labelOutcome(outcome: string): string {
  return outcome.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function runDoctorCommand(): Promise<void> {
  const store = await openStoreOrExit();
  const result = await ingestAiSessions(store);
  const claudeCount = store.countIngestedFiles("claude");
  const codexCount = store.countIngestedFiles("codex");
  const totalSessions = store.countSessions();
  const diagnostics = store.listDiagnostics(20);
  store.close();

  console.log("");
  console.log(chalk.bold("AI Studio doctor"));
  console.log("");
  console.log(`Storage:            ${aiStudioStorageDir()}`);
  console.log(`Claude files:       ${claudeCount} ingested`);
  console.log(`Codex files:        ${codexCount} ingested`);
  console.log(`Total sessions:     ${totalSessions}`);
  console.log("");
  console.log(chalk.bold("Last refresh:"));
  console.log(`  Discovered:       ${result.filesDiscovered}`);
  console.log(`  Newly ingested:   ${result.filesIngested}`);
  console.log(`  Unchanged:        ${result.filesSkippedUnchanged}`);
  console.log(`  Failed:           ${result.filesFailed}`);
  console.log(`  Took:             ${formatDuration(result.durationMs)}`);

  if (diagnostics.length) {
    console.log("");
    console.log(chalk.bold(`Recent parser diagnostics (${diagnostics.length}):`));
    for (const diagnostic of diagnostics.slice(0, 10)) {
      const icon = diagnostic.severity === "error" ? chalk.red("✗") : diagnostic.severity === "warning" ? chalk.yellow("⚠") : chalk.gray("i");
      console.log(`  ${icon} [${diagnostic.provider}] ${diagnostic.message}`);
      console.log(chalk.gray(`     ${diagnostic.sourceFile}`));
    }
  } else {
    console.log("");
    console.log(chalk.green("No parser diagnostics recorded."));
  }
  console.log("");
}

async function runExportCommand(sessionIdArg: string | undefined, options: { format?: string }): Promise<void> {
  const store = await openStoreOrExit();
  await ingestAiSessions(store);
  const sessionId = sessionIdArg ?? (await pickSessionInteractively(store));
  if (!sessionId) {
    console.log("No AI sessions found yet.");
    store.close();
    return;
  }
  const session = store.getSession(sessionId);
  if (!session) {
    console.error(chalk.red(`Session not found: ${sessionId}`));
    store.close();
    process.exitCode = 1;
    return;
  }
  const observations = store.getObservations(sessionId);
  const turns = deriveTurns(observations);
  const analysis = analyzeSession(sessionId, observations);
  store.close();

  const { exportSession } = await import("../core/ai/ai-session-export");
  const format = options.format === "json" ? "json" : "markdown";
  const exported = exportSession({ session, turns, observations, analysis }, format);
  console.log(exported.content);
}

export function registerAiCommands(program: Command): void {
  const ai = program.command("ai").description("Local AI coding session observability (Claude Code + Codex)");

  ai.command("studio")
    .description("Open the local AI Studio (browser UI) for analyzing Claude Code / Codex sessions")
    .option("--port <port>", "Preferred local port (auto-falls back if busy)")
    .option("--dev-ui", "Frontend development mode: API-only server + instructions to run the Vite dev server separately")
    .option("--api-only", "Start only the JSON API — no UI is served, no browser opens")
    .action(runStudioCommand);

  ai.command("sessions")
    .description("List recent AI sessions in the terminal")
    .option("--provider <provider>", "Filter by provider (claude|codex)")
    .option("--project <project>", "Filter by project name")
    .option("--limit <n>", "Max sessions to show", "20")
    .action(runSessionsCommand);

  ai.command("inspect [sessionId]")
    .description("Show a detailed summary of one AI session (prompts interactively if omitted)")
    .action(runInspectCommand);

  ai.command("doctor")
    .description("Report AI Studio ingestion status, parser health, and storage location")
    .action(runDoctorCommand);

  ai.command("scan")
    .alias("refresh")
    .description("Re-scan ~/.claude and ~/.codex for new or changed sessions")
    .action(async () => {
      const store = await openStoreOrExit();
      const result = await ingestAiSessions(store);
      store.close();
      console.log(`Discovered ${result.filesDiscovered}, ingested ${result.filesIngested}, unchanged ${result.filesSkippedUnchanged}, failed ${result.filesFailed}.`);
    });

  ai.command("export [sessionId]")
    .description("Export one session as Markdown or JSON (prompts interactively if omitted)")
    .option("--format <format>", "markdown|json", "markdown")
    .action(runExportCommand);
}
