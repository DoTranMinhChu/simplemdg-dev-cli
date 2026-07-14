import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { analyzeVerification, classifySessionOutcome } from "./ai-session-analysis";
import { computeQuickGrade } from "./ai-session-advisor";
import { redactSecrets } from "./ai-secret-redaction";
import { getContextWindowTokens } from "./ai-model-context-windows";
import type { TAiObservation, TAiSession, TIngestedSessionFile, TParsedAiSession, TParserDiagnostic } from "./ai-types";

type TSqliteStatement = {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
};

type TSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): TSqliteStatement;
  close(): void;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  project TEXT NOT NULL,
  cwd TEXT NOT NULL,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  git_branch TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  turn_count INTEGER NOT NULL,
  observation_count INTEGER NOT NULL,
  tool_call_count INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  parent_session_id TEXT NOT NULL DEFAULT '',
  source_file TEXT NOT NULL,
  analysis_status TEXT NOT NULL DEFAULT 'complete',
  outcome TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  input TEXT NOT NULL,
  output TEXT NOT NULL,
  tokens INTEGER NOT NULL,
  sidechain INTEGER NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  is_error INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id, idx);

CREATE TABLE IF NOT EXISTS scores (
  session_id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_flags (
  session_id TEXT PRIMARY KEY,
  pinned INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ingested_files (
  path TEXT PRIMARY KEY,
  modified_at_ms REAL NOT NULL,
  size_bytes INTEGER NOT NULL,
  provider TEXT NOT NULL,
  last_ingested_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parser_diagnostics (
  rowid_key INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  source_file TEXT NOT NULL,
  severity TEXT NOT NULL,
  record_type TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  sample TEXT NOT NULL DEFAULT '',
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_diagnostics_file ON parser_diagnostics(source_file);
`;

export function aiStudioStorageDir(): string {
  return path.join(os.homedir(), ".simplemdg", "ai-studio");
}

/** Adds the `outcome` column to a pre-existing `sessions` table (databases created before this field existed). A no-op on fresh databases, where SCHEMA already declares the column. */
function migrateOutcomeColumn(db: TSqliteDatabase): void {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "outcome")) {
    db.exec("ALTER TABLE sessions ADD COLUMN outcome TEXT NOT NULL DEFAULT ''");
  }
}

/** Adds the `cache_creation_tokens` column to a pre-existing `sessions` table. Pre-migration rows default to 0 (undercounts their true cache-write spend, same tradeoff `migrateOutcomeColumn` makes for `outcome`) until the source file is re-ingested. */
function migrateCacheCreationColumn(db: TSqliteDatabase): void {
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "cache_creation_tokens")) {
    db.exec("ALTER TABLE sessions ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0");
  }
}

export type TSessionFilter = {
  provider?: string;
  project?: string;
  search?: string;
  hasErrors?: boolean;
  pinnedOnly?: boolean;
};

export type TSessionRow = TAiSession;

export class AiSessionStore {
  private constructor(private db: TSqliteDatabase) {}

  static async open(): Promise<AiSessionStore | undefined> {
    // node:sqlite is a Node 22.5+ built-in with no bare-specifier form ("sqlite" alone is not a
    // built-in — only "node:sqlite" is). A dynamic `import("node:sqlite")` here gets its "node:"
    // prefix silently stripped by esbuild/tsup when bundled (a known esbuild quirk for
    // node:-prefix-only built-ins), which then always throws — this is why the *bundled* CLI could
    // report "node:sqlite is unavailable" even on Node 22.5+, while `tsx`/ts-node (unbundled) never
    // hit it. process.getBuiltinModule() is a plain runtime call a bundler can't rewrite.
    const sqliteModule = process.getBuiltinModule?.("node:sqlite") as { DatabaseSync: new (dbPath: string) => TSqliteDatabase } | undefined;
    if (!sqliteModule) return undefined;
    const { DatabaseSync } = sqliteModule;

    const dir = aiStudioStorageDir();
    await fs.ensureDir(dir);
    const db = new DatabaseSync(path.join(dir, "traces.db"));
    db.exec(SCHEMA);
    migrateOutcomeColumn(db);
    migrateCacheCreationColumn(db);
    const store = new AiSessionStore(db);
    store.backfillOutcomes();
    return store;
  }

  close(): void {
    this.db.close();
  }

  /** One-time backfill for rows persisted before `outcome` existed (sentinel `''`, distinct from the real `"unknown"` value) — a no-op once every row has been classified. */
  private backfillOutcomes(): void {
    const stale = this.db.prepare("SELECT id, error_count FROM sessions WHERE outcome = ''").all() as Array<{ id: string; error_count: number }>;
    for (const row of stale) {
      const observations = this.getObservations(row.id);
      const verification = analyzeVerification(observations);
      const { outcome } = classifySessionOutcome({ errorCount: Number(row.error_count), verification });
      this.db.prepare("UPDATE sessions SET outcome = ? WHERE id = ?").run(outcome, row.id);
    }
  }

  // --- Incremental ingestion tracking ------------------------------------

  getIngestedFile(filePath: string): TIngestedSessionFile | undefined {
    const row = this.db.prepare("SELECT * FROM ingested_files WHERE path = ?").get(filePath) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      path: String(row.path),
      modifiedAtMs: Number(row.modified_at_ms),
      sizeBytes: Number(row.size_bytes),
      provider: row.provider as TIngestedSessionFile["provider"],
      lastIngestedAt: String(row.last_ingested_at),
    };
  }

  markFileIngested(file: TIngestedSessionFile): void {
    this.db
      .prepare("INSERT OR REPLACE INTO ingested_files (path, modified_at_ms, size_bytes, provider, last_ingested_at) VALUES (?, ?, ?, ?, ?)")
      .run(file.path, file.modifiedAtMs, file.sizeBytes, file.provider, file.lastIngestedAt);
  }

  countIngestedFiles(provider?: string): number {
    const row = provider
      ? (this.db.prepare("SELECT COUNT(*) AS n FROM ingested_files WHERE provider = ?").get(provider) as { n: number })
      : (this.db.prepare("SELECT COUNT(*) AS n FROM ingested_files").get() as { n: number });
    return Number(row.n);
  }

  addDiagnostic(diagnostic: TParserDiagnostic): void {
    this.db
      .prepare("INSERT INTO parser_diagnostics (provider, source_file, severity, record_type, message, sample, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(diagnostic.provider, diagnostic.sourceFile, diagnostic.severity, diagnostic.recordType ?? "", diagnostic.message, diagnostic.sample ?? "", diagnostic.occurredAt);
  }

  listDiagnostics(limit = 200): TParserDiagnostic[] {
    const rows = this.db.prepare("SELECT * FROM parser_diagnostics ORDER BY rowid_key DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      provider: row.provider as TParserDiagnostic["provider"],
      sourceFile: String(row.source_file),
      severity: row.severity as TParserDiagnostic["severity"],
      recordType: String(row.record_type) || undefined,
      message: String(row.message),
      sample: String(row.sample) || undefined,
      occurredAt: String(row.occurred_at),
    }));
  }

  clearDiagnosticsForFile(sourceFile: string): void {
    this.db.prepare("DELETE FROM parser_diagnostics WHERE source_file = ?").run(sourceFile);
  }

  // --- Session + observation persistence ----------------------------------

  saveSession(
    parsed: TParsedAiSession,
    derived: { durationMs: number; turnCount: number; toolCallCount: number; errorCount: number; outcome: TAiSession["outcome"] },
  ): void {
    const { session, observations } = parsed;
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT OR REPLACE INTO sessions
           (id, provider, project, cwd, title, model, git_branch, started_at, ended_at, duration_ms,
            input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, turn_count, observation_count, tool_call_count,
            error_count, parent_session_id, source_file, analysis_status, outcome)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          session.id,
          session.provider,
          session.project,
          session.cwd,
          session.title,
          session.model,
          session.gitBranch ?? "",
          session.startedAt,
          session.endedAt,
          derived.durationMs,
          session.inputTokens,
          session.outputTokens,
          session.cacheReadTokens,
          session.cacheCreationTokens,
          derived.turnCount,
          observations.length,
          derived.toolCallCount,
          derived.errorCount,
          session.parentSessionId ?? "",
          session.sourceFile,
          "complete",
          derived.outcome,
        );
      this.db.prepare("DELETE FROM observations WHERE session_id = ?").run(session.id);
      const insert = this.db.prepare(
        `INSERT INTO observations
         (id, session_id, idx, type, name, started_at, duration_ms, input, output, tokens, sidechain, parent_id, is_error, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const observation of observations) {
        insert.run(
          observation.id,
          observation.sessionId,
          observation.idx,
          observation.type,
          observation.name,
          observation.startedAt,
          observation.durationMs,
          observation.input,
          observation.output,
          observation.tokens,
          observation.sidechain ? 1 : 0,
          observation.parentId,
          observation.isError ? 1 : 0,
          observation.metadata,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  deleteSession(sessionId: string): void {
    this.db.prepare("DELETE FROM observations WHERE session_id = ?").run(sessionId);
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  countSessions(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number };
    return Number(row.n);
  }

  listSessions(options: { filter?: TSessionFilter; cursor?: string; limit: number }): { sessions: TAiSession[]; nextCursor?: string } {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options.filter?.provider) {
      conditions.push("s.provider = ?");
      params.push(options.filter.provider);
    }
    if (options.filter?.project) {
      conditions.push("s.project = ?");
      params.push(options.filter.project);
    }
    if (options.filter?.hasErrors) {
      conditions.push("s.error_count > 0");
    }
    if (options.filter?.pinnedOnly) {
      conditions.push("f.pinned = 1");
    }
    if (options.filter?.search) {
      conditions.push("(s.title LIKE ? OR s.project LIKE ? OR s.model LIKE ? OR s.cwd LIKE ?)");
      const like = `%${options.filter.search}%`;
      params.push(like, like, like, like);
    }
    if (options.cursor) {
      conditions.push("s.started_at < ?");
      params.push(options.cursor);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = this.db
      .prepare(
        `SELECT s.*, COALESCE(sc.value, '') AS user_score, COALESCE(f.pinned, 0) AS pinned, COALESCE(f.favorite, 0) AS favorite,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = s.id) AS sub_agent_count
         FROM sessions s
         LEFT JOIN scores sc ON sc.session_id = s.id
         LEFT JOIN session_flags f ON f.session_id = s.id
         ${where}
         ORDER BY s.started_at DESC
         LIMIT ?`,
      )
      .all(...params, options.limit + 1) as Array<Record<string, unknown>>;

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    return {
      sessions: page.map(rowToSession),
      nextCursor: hasMore ? String(page[page.length - 1].started_at) : undefined,
    };
  }

  getSession(sessionId: string): TAiSession | undefined {
    const row = this.db
      .prepare(
        `SELECT s.*, COALESCE(sc.value, '') AS user_score, COALESCE(f.pinned, 0) AS pinned, COALESCE(f.favorite, 0) AS favorite,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = s.id) AS sub_agent_count
         FROM sessions s
         LEFT JOIN scores sc ON sc.session_id = s.id
         LEFT JOIN session_flags f ON f.session_id = s.id
         WHERE s.id = ?`,
      )
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? rowToSession(row) : undefined;
  }

  /** Direct children (sub-agent sessions) of `parentId`, oldest spawned first — the whole-session orchestration tree's rows. */
  listChildSessions(parentId: string): TAiSession[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, COALESCE(sc.value, '') AS user_score, COALESCE(f.pinned, 0) AS pinned, COALESCE(f.favorite, 0) AS favorite,
                (SELECT COUNT(*) FROM sessions c WHERE c.parent_session_id = s.id) AS sub_agent_count
         FROM sessions s
         LEFT JOIN scores sc ON sc.session_id = s.id
         LEFT JOIN session_flags f ON f.session_id = s.id
         WHERE s.parent_session_id = ?
         ORDER BY s.started_at ASC`,
      )
      .all(parentId) as Array<Record<string, unknown>>;
    return rows.map(rowToSession);
  }

  setFlag(sessionId: string, flag: "pinned" | "favorite", value: boolean): void {
    const existing = this.db.prepare("SELECT pinned, favorite FROM session_flags WHERE session_id = ?").get(sessionId) as { pinned: number; favorite: number } | undefined;
    const pinned = flag === "pinned" ? value : Boolean(existing?.pinned);
    const favorite = flag === "favorite" ? value : Boolean(existing?.favorite);
    this.db
      .prepare("INSERT OR REPLACE INTO session_flags (session_id, pinned, favorite, updated_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, pinned ? 1 : 0, favorite ? 1 : 0, new Date().toISOString());
  }

  listProjects(): Array<{ project: string; sessionCount: number }> {
    const rows = this.db.prepare("SELECT project, COUNT(*) AS n FROM sessions GROUP BY project ORDER BY n DESC").all() as Array<{ project: string; n: number }>;
    return rows.map((row) => ({ project: row.project, sessionCount: Number(row.n) }));
  }

  getObservations(sessionId: string): TAiObservation[] {
    const rows = this.db.prepare("SELECT * FROM observations WHERE session_id = ? ORDER BY idx").all(sessionId) as Array<Record<string, unknown>>;
    return rows.map(rowToObservation);
  }

  setScore(sessionId: string, value: "good" | "bad"): void {
    this.db.prepare("INSERT OR REPLACE INTO scores (session_id, value, timestamp) VALUES (?, ?, ?)").run(sessionId, value, new Date().toISOString());
  }

  overview(): {
    totalSessions: number;
    totalTokens: number;
    totalCacheReadTokens: number;
    totalDurationMs: number;
    totalToolCalls: number;
    totalErrors: number;
    byProvider: Array<{ provider: string; count: number }>;
  } {
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS sessions,
                COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens,
                COALESCE(SUM(cache_read_tokens), 0) AS cacheTokens,
                COALESCE(SUM(duration_ms), 0) AS duration,
                COALESCE(SUM(tool_call_count), 0) AS tools,
                COALESCE(SUM(error_count), 0) AS errors
         FROM sessions`,
      )
      .get() as { sessions: number; tokens: number; cacheTokens: number; duration: number; tools: number; errors: number };
    const byProvider = this.db.prepare("SELECT provider, COUNT(*) AS n FROM sessions GROUP BY provider").all() as Array<{ provider: string; n: number }>;
    return {
      totalSessions: Number(totals.sessions),
      totalTokens: Number(totals.tokens),
      totalCacheReadTokens: Number(totals.cacheTokens),
      totalDurationMs: Number(totals.duration),
      totalToolCalls: Number(totals.tools),
      totalErrors: Number(totals.errors),
      byProvider: byProvider.map((row) => ({ provider: row.provider, count: Number(row.n) })),
    };
  }
}

function rowToSession(row: Record<string, unknown>): TAiSession {
  const session: TAiSession = {
    id: String(row.id),
    provider: row.provider as TAiSession["provider"],
    project: String(row.project),
    cwd: String(row.cwd),
    title: redactSecrets(String(row.title)),
    model: String(row.model),
    gitBranch: String(row.git_branch ?? "") || undefined,
    startedAt: String(row.started_at),
    endedAt: String(row.ended_at),
    durationMs: Number(row.duration_ms),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cacheReadTokens: Number(row.cache_read_tokens),
    cacheCreationTokens: Number(row.cache_creation_tokens ?? 0),
    turnCount: Number(row.turn_count),
    observationCount: Number(row.observation_count),
    toolCallCount: Number(row.tool_call_count),
    errorCount: Number(row.error_count),
    parentSessionId: String(row.parent_session_id ?? "") || undefined,
    subAgentCount: Number(row.sub_agent_count ?? 0),
    sourceFile: String(row.source_file),
    analysisStatus: row.analysis_status as TAiSession["analysisStatus"],
    userScore: (row.user_score as TAiSession["userScore"]) ?? "",
    pinned: Boolean(row.pinned),
    favorite: Boolean(row.favorite),
    outcome: (row.outcome as TAiSession["outcome"]) || "unknown",
    contextWindowTokens: getContextWindowTokens(String(row.model)),
  };
  const quickGrade = computeQuickGrade(session);
  session.advisorGrade = quickGrade?.grade;
  session.advisorScore = quickGrade?.score;
  return session;
}

function rowToObservation(row: Record<string, unknown>): TAiObservation {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    idx: Number(row.idx),
    type: row.type as TAiObservation["type"],
    name: String(row.name),
    startedAt: String(row.started_at),
    durationMs: Number(row.duration_ms),
    input: String(row.input),
    output: String(row.output),
    tokens: Number(row.tokens),
    sidechain: Boolean(row.sidechain),
    parentId: String(row.parent_id ?? ""),
    isError: Boolean(row.is_error),
    metadata: String(row.metadata ?? ""),
  };
}
