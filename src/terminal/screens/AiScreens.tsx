import React, { useEffect, useRef, useState } from "react";
import { Text } from "ink";
import { SearchableList } from "../components/SearchableList";
import { analyzeSession, deriveTurns } from "../../core/ai/ai-session-analysis";
import { ingestAiSessions } from "../../core/ai/ai-session-ingestion";
import { AiSessionStore, aiStudioStorageDir } from "../../core/ai/ai-session-store";
import { openProjectFolder, openProjectInVsCode } from "../../core/ai/ai-session-command-service";
import { getSessionLauncher } from "../../core/ai/launchers/claude-session-launcher";
import type { TAiSession } from "../../core/ai/ai-types";
import type { InkInteractionService } from "../services/ink-interaction-service";

type TScreenProps = { service: InkInteractionService; onDone: (success: boolean) => void; maxVisibleRows?: number };

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
  return session.errorCount > 0 ? "PARTIAL" : "SUCCESS";
}

function labelOutcome(outcome: string): string {
  return outcome.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function openStoreOrNotify(service: InkInteractionService): Promise<AiSessionStore | undefined> {
  const store = await AiSessionStore.open();
  if (!store) {
    service.notify({ level: "error", message: "AI Studio requires Node.js 22.5+ for its local SQLite store (node:sqlite)." });
    return undefined;
  }
  return store;
}

export function AiSessionsScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const store = await openStoreOrNotify(props.service);
      if (!store) return props.onDone(false);

      await ingestAiSessions(store);
      const { sessions } = store.listSessions({ limit: 20 });
      store.close();

      if (!sessions.length) {
        props.service.notify({ level: "muted", message: "No AI sessions found yet. Use Claude Code or Codex, then re-run this command." });
        return props.onDone(true);
      }

      for (const session of sessions) {
        const provider = session.provider === "claude" ? "Claude" : session.provider === "codex" ? "Codex" : session.provider;
        props.service.notify({
          level: "muted",
          message: `${statusLabel(session).padEnd(8)} ${provider.padEnd(8)} ${session.project.slice(0, 28).padEnd(28)} ${formatDuration(session.durationMs).padEnd(9)} ${formatTokens(session.inputTokens + session.outputTokens)}\n  ${session.id}  ${session.title.slice(0, 90)}`,
        });
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function AiDoctorScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const store = await openStoreOrNotify(props.service);
      if (!store) return props.onDone(false);

      const result = await ingestAiSessions(store);
      const claudeCount = store.countIngestedFiles("claude");
      const codexCount = store.countIngestedFiles("codex");
      const totalSessions = store.countSessions();
      const diagnostics = store.listDiagnostics(20);
      store.close();

      const notify = (message: string) => props.service.notify({ level: "muted", message });
      notify(`Storage: ${aiStudioStorageDir()}`);
      notify(`Claude files: ${claudeCount} ingested — Codex files: ${codexCount} ingested — Total sessions: ${totalSessions}`);
      notify(
        `Last refresh — discovered ${result.filesDiscovered}, ingested ${result.filesIngested}, unchanged ${result.filesSkippedUnchanged}, failed ${result.filesFailed}, took ${formatDuration(result.durationMs)}`,
      );

      if (diagnostics.length) {
        for (const diagnostic of diagnostics.slice(0, 10)) {
          props.service.notify({
            level: diagnostic.severity === "error" ? "error" : diagnostic.severity === "warning" ? "warn" : "muted",
            message: `[${diagnostic.provider}] ${diagnostic.message}\n  ${diagnostic.sourceFile}`,
          });
        }
      } else {
        props.service.notify({ level: "success", message: "No parser diagnostics recorded." });
      }
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

export function AiScanScreen(props: { service: InkInteractionService; onDone: (success: boolean) => void }) {
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const store = await openStoreOrNotify(props.service);
      if (!store) return props.onDone(false);

      const result = await ingestAiSessions(store);
      store.close();
      props.service.notify({
        level: "success",
        message: `Discovered ${result.filesDiscovered}, ingested ${result.filesIngested}, unchanged ${result.filesSkippedUnchanged}, failed ${result.filesFailed}.`,
      });
      props.onDone(true);
    })();
  }, []);

  return <Text dimColor>Working…</Text>;
}

/** Shared "pick a recent session" step used by inspect/export/open/copy-command. */
function useSessionPicker(props: { service: InkInteractionService; onDone: (success: boolean) => void }): {
  choices: { title: string; value: string }[] | undefined;
  sessionId: string | undefined;
  pick: (id: string) => void;
} {
  const [choices, setChoices] = useState<{ title: string; value: string }[] | undefined>(undefined);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const store = await openStoreOrNotify(props.service);
      if (!store) return props.onDone(false);

      await ingestAiSessions(store);
      const { sessions } = store.listSessions({ limit: 25 });
      store.close();

      if (!sessions.length) {
        props.service.notify({ level: "muted", message: "No AI sessions found yet." });
        return props.onDone(true);
      }

      setChoices(sessions.map((session) => ({ title: `${session.project} — ${session.title.slice(0, 70)}`, value: session.id })));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { choices, sessionId, pick: setSessionId };
}

async function loadResolvedSession(sessionId: string, service: InkInteractionService): Promise<TAiSession | undefined> {
  const store = await openStoreOrNotify(service);
  if (!store) return undefined;
  const session = store.getSession(sessionId);
  store.close();
  if (!session) {
    service.notify({ level: "error", message: `Session not found: ${sessionId}` });
  }
  return session;
}

export function AiInspectScreen(props: TScreenProps) {
  const { choices, sessionId, pick } = useSessionPicker(props);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const store = await openStoreOrNotify(props.service);
      if (!store) return props.onDone(false);

      const session = store.getSession(sessionId);
      if (!session) {
        props.service.notify({ level: "error", message: `Session not found: ${sessionId}` });
        store.close();
        return props.onDone(false);
      }
      const observations = store.getObservations(sessionId);
      const analysis = analyzeSession(sessionId, observations);
      store.close();

      const notify = (message: string) => props.service.notify({ level: "muted", message });
      notify(session.title);
      notify(
        `Provider: ${session.provider} · Project: ${session.project} · Model: ${session.model || "unknown"} · Duration: ${formatDuration(session.durationMs)}`,
      );
      notify(
        `Tokens: ${formatTokens(session.inputTokens + session.outputTokens)} (cache-read ${formatTokens(session.cacheReadTokens)}) · Tools: ${session.toolCallCount} · Errors: ${session.errorCount} · Files: ${analysis.fileImpact.length} touched`,
      );

      if (!analysis.verification.length) {
        notify("Verification: (none observed)");
      } else {
        for (const check of analysis.verification) {
          notify(`  ${check.status === "pass" ? "✓" : check.status === "fail" ? "✗" : "?"} ${check.label}`);
        }
      }

      notify(`Outcome: ${labelOutcome(analysis.outcome)}`);
      for (const evidence of analysis.outcomeEvidence) notify(`  - ${evidence}`);
      if (analysis.errorGroups.length) {
        notify(`Top risk: ${analysis.errorGroups[0].category} — ${analysis.errorGroups[0].message.slice(0, 100)} (${analysis.errorGroups[0].count}x)`);
      }
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!sessionId) {
    if (!choices) return <Text dimColor>Loading sessions…</Text>;
    return (
      <SearchableList
        message="Select a session"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function AiExportScreen(props: TScreenProps) {
  const { choices, sessionId, pick } = useSessionPicker(props);
  const [format, setFormat] = useState<"markdown" | "json" | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!sessionId || !format || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const store = await openStoreOrNotify(props.service);
      if (!store) return props.onDone(false);

      const session = store.getSession(sessionId);
      if (!session) {
        props.service.notify({ level: "error", message: `Session not found: ${sessionId}` });
        store.close();
        return props.onDone(false);
      }
      const observations = store.getObservations(sessionId);
      const turns = deriveTurns(observations);
      const analysis = analyzeSession(sessionId, observations);
      store.close();

      const { exportSession } = await import("../../core/ai/ai-session-export");
      const exported = exportSession({ session, turns, observations, analysis }, format);
      props.service.notify({ level: "muted", message: exported.content });
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, format]);

  if (!sessionId) {
    if (!choices) return <Text dimColor>Loading sessions…</Text>;
    return (
      <SearchableList
        message="Select a session"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (!format) {
    return (
      <SearchableList
        message="Export format"
        choices={[
          { title: "Markdown", value: "markdown" },
          { title: "JSON", value: "json" },
        ]}
        onSubmit={(value) => setFormat(value as "markdown" | "json")}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function AiOpenScreen(props: TScreenProps) {
  const { choices, sessionId, pick } = useSessionPicker(props);
  const [target, setTarget] = useState<"folder" | "vscode" | undefined>(undefined);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!sessionId || !target || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const session = await loadResolvedSession(sessionId, props.service);
      if (!session) return props.onDone(false);

      const result = target === "vscode" ? await openProjectInVsCode(session.cwd) : await openProjectFolder(session.cwd);
      if (!result.ok) {
        props.service.notify({ level: "error", message: result.error ?? "Failed to open the project." });
        return props.onDone(false);
      }
      props.service.notify({ level: "success", message: target === "vscode" ? "Opened the project in VS Code." : "Opened the project folder." });
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, target]);

  if (!sessionId) {
    if (!choices) return <Text dimColor>Loading sessions…</Text>;
    return (
      <SearchableList
        message="Select a session"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  if (!target) {
    return (
      <SearchableList
        message="Open with"
        choices={[
          { title: "OS file explorer", value: "folder" },
          { title: "VS Code", value: "vscode" },
        ]}
        onSubmit={(value) => setTarget(value as "folder" | "vscode")}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}

export function AiCopyCommandScreen(props: TScreenProps) {
  const { choices, sessionId, pick } = useSessionPicker(props);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!sessionId || startedRef.current) return;
    startedRef.current = true;

    void (async () => {
      const session = await loadResolvedSession(sessionId, props.service);
      if (!session) return props.onDone(false);

      const launcher = getSessionLauncher(session.provider);
      if (!launcher) {
        props.service.notify({ level: "error", message: `Resuming ${session.provider} sessions is not supported yet.` });
        return props.onDone(false);
      }

      const launch = launcher.buildResumeCommand(session, { includeChangeDirectory: true });
      props.service.notify({ level: "info", message: `Copy and run this to resume the session:\n${launch.command}` });
      props.onDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  if (!sessionId) {
    if (!choices) return <Text dimColor>Loading sessions…</Text>;
    return (
      <SearchableList
        message="Select a session"
        choices={choices}
        limit={props.maxVisibleRows !== undefined ? Math.max(1, props.maxVisibleRows - 2) : undefined}
        onSubmit={pick}
        onCancel={() => props.onDone(false)}
      />
    );
  }

  return <Text dimColor>Working…</Text>;
}
