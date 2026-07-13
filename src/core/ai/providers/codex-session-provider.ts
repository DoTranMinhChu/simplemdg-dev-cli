import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import fg from "fast-glob";
import type { IAiSessionProvider, TAiObservation, TAiObservationType, TParsedAiSession, TSessionFile } from "../ai-types";

const MAX_FIELD_LENGTH = 20000;

export function codexSessionsRoot(): string {
  return path.join(os.homedir(), ".codex", "sessions");
}

/** Parses Codex's `~/.codex/sessions/**\/rollout-*.jsonl` transcripts. */
export class CodexSessionProvider implements IAiSessionProvider {
  readonly id = "codex" as const;

  async discoverSessionFiles(): Promise<TSessionFile[]> {
    const root = codexSessionsRoot();
    if (!(await fs.pathExists(root))) return [];

    const files = await fg("**/rollout-*.jsonl", { cwd: root, absolute: true, followSymbolicLinks: false });
    const results: TSessionFile[] = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        results.push({ path: file, provider: "codex", modifiedAtMs: stat.mtimeMs, sizeBytes: stat.size });
      } catch {
        // Deleted between glob and stat; skip.
      }
    }
    return results;
  }

  parseSession(file: TSessionFile, content: string): TParsedAiSession | undefined {
    return parseCodexSession(file.path, content);
  }
}

export function parseCodexSession(filePath: string, content: string): TParsedAiSession | undefined {
  const observations: TAiObservation[] = [];
  const pendingTools = new Map<string, TAiObservation>();

  let sessionId = "";
  let cwd = "";
  let model = "";
  let title = "";
  // The reliable prompt lives in a dedicated `user_message` event; the first response_item user turn
  // is an injected context blob, so it must not be used as the title.
  let promptTitle = "";
  let parentThreadId = "";
  let firstAt = "";
  let lastAt = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let userIdx = -1;
  let assistantIdx = -1;

  for (const line of jsonLines(content)) {
    const timestamp = str(line.timestamp);
    if (timestamp) {
      firstAt = firstAt || timestamp;
      lastAt = timestamp;
    }
    const payload = obj(line.payload);

    if (line.type === "session_meta") {
      sessionId = str(payload.id) || str(payload.session_id) || sessionId;
      cwd = str(payload.cwd) || cwd;
      parentThreadId = str(payload.parent_thread_id) || parentThreadId;
      continue;
    }

    if (line.type === "turn_context") {
      model = str(payload.model) || model;
      cwd = cwd || str(payload.cwd);
      continue;
    }

    if (line.type === "event_msg") {
      const event = obj(payload);
      if (event.type === "token_count") {
        const usage = obj(obj(event.info).total_token_usage);
        inputTokens = num(usage.input_tokens) - num(usage.cached_input_tokens);
        outputTokens = num(usage.output_tokens);
        cacheReadTokens = num(usage.cached_input_tokens);
      } else if (event.type === "user_message") {
        promptTitle = promptTitle || str(event.message).trim();
      }
      continue;
    }

    if (line.type !== "response_item") continue;

    if (payload.type === "message") {
      const text = contentText(payload.content).trim();
      if (payload.role === "user") {
        if (isCodexContext(text)) continue;
        title = title || text;
        userIdx = observations.length;
        assistantIdx = -1;
        observations.push(makeObservation(userIdx, "user", "user", timestamp, text, "", 0, false));
      } else if (payload.role === "assistant" && text) {
        assistantIdx = observations.length;
        observations.push(makeObservation(assistantIdx, "assistant", "assistant", timestamp, "", text, 0, false, userIdx));
      }
    } else if (payload.type === "reasoning") {
      const text = contentText(payload.summary) || contentText(payload.content);
      if (text.trim()) {
        observations.push(makeObservation(observations.length, "reasoning", "reasoning", timestamp, "", text, 0, false, assistantIdx >= 0 ? assistantIdx : userIdx));
      }
    } else if (payload.type === "function_call" || payload.type === "custom_tool_call") {
      const parentIdx = assistantIdx >= 0 ? assistantIdx : userIdx;
      const toolName = str(payload.name) || "tool";
      const type: TAiObservationType = toolName.startsWith("mcp__") ? "mcp-call" : "tool-call";
      const tool = makeObservation(observations.length, type, toolName, timestamp, str(payload.arguments) || str(payload.input), "", 0, false, parentIdx);
      observations.push(tool);
      pendingTools.set(str(payload.call_id), tool);
    } else if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
      const pending = pendingTools.get(str(payload.call_id));
      if (pending) {
        const outputText = textOf(payload.output);
        pending.output = clamp(outputText);
        pending.durationMs = elapsed(pending.startedAt, timestamp);
        if (looksLikeToolError(payload.output, outputText)) pending.isError = true;
        pendingTools.delete(str(payload.call_id));
      }
    } else if (payload.type === "local_shell_call") {
      const action = obj(payload.action);
      const command = Array.isArray(action.command) ? action.command.join(" ") : str(action.command);
      const parentIdx = assistantIdx >= 0 ? assistantIdx : userIdx;
      observations.push(makeObservation(observations.length, "shell-command", "shell", timestamp, command, "", 0, false, parentIdx));
    }
  }

  if (!sessionId) return undefined;

  return buildParsedSession({
    id: `codex:${sessionId}`,
    provider: "codex",
    cwd,
    fallbackProject: "codex",
    title: promptTitle || title,
    model,
    firstAt,
    lastAt,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    file: filePath,
    parentSessionId: parentThreadId ? `codex:${parentThreadId}` : undefined,
    observations,
  });
}

function buildParsedSession(input: {
  id: string;
  provider: "codex";
  cwd: string;
  fallbackProject: string;
  title: string;
  model: string;
  firstAt: string;
  lastAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  file: string;
  parentSessionId?: string;
  observations: TAiObservation[];
}): TParsedAiSession {
  // Codex's usage payload has no cache-write/creation concept — always 0, distinct from "unknown".
  for (const observation of input.observations) {
    observation.sessionId = input.id;
    observation.id = `${input.id}:${observation.idx}`;
    observation.parentId = observation.parentId === "" ? "" : `${input.id}:${observation.parentId}`;
    observation.input = clamp(observation.input);
    observation.output = clamp(observation.output);
  }

  return {
    session: {
      id: input.id,
      provider: input.provider,
      project: input.cwd ? path.basename(input.cwd) : input.fallbackProject,
      cwd: input.cwd,
      title: clip(input.title, 120) || input.id,
      model: input.model,
      gitBranch: undefined,
      startedAt: input.firstAt,
      endedAt: input.lastAt,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens,
      cacheCreationTokens: 0,
      parentSessionId: input.parentSessionId,
      sourceFile: input.file,
    },
    observations: input.observations,
  };
}

function makeObservation(
  idx: number,
  type: TAiObservationType,
  name: string,
  startedAt: string,
  input: string,
  output: string,
  tokens: number,
  sidechain: boolean,
  parentIdx = -1,
): TAiObservation {
  return {
    id: String(idx),
    sessionId: "",
    idx,
    type,
    name,
    startedAt,
    durationMs: 0,
    input,
    output,
    tokens,
    sidechain,
    parentId: parentIdx >= 0 ? String(parentIdx) : "",
    isError: false,
    metadata: "",
  };
}

function* jsonLines(content: string): Generator<Record<string, unknown>> {
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) yield parsed as Record<string, unknown>;
    } catch {
      // Skip partially written or malformed lines; ingestion tracks these separately.
    }
  }
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Codex injects context (plugins, AGENTS.md, environment, agent role) as user turns; these are not the prompt.
function isCodexContext(text: string): boolean {
  return !text || text.startsWith("<") || text.startsWith("# AGENTS.md") || /^You are\b/.test(text);
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => str(obj(item).text))
    .filter(Boolean)
    .join("\n");
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : str(obj(item).text) || JSON.stringify(item))).join("\n");
  if (value && typeof value === "object") {
    const inner = obj(value);
    return str(inner.text) || str(inner.output) || str(inner.content) || JSON.stringify(value);
  }
  return "";
}

// Codex function_call_output payloads may carry an explicit success flag or a shell-style exit code;
// fall back to a light textual heuristic only when neither is present.
function looksLikeToolError(rawOutput: unknown, outputText: string): boolean {
  const inner = obj(rawOutput);
  if (typeof inner.success === "boolean") return !inner.success;
  if (typeof inner.exit_code === "number") return inner.exit_code !== 0;
  if (typeof inner.metadata === "object" && inner.metadata) {
    const metadata = obj(inner.metadata);
    if (typeof metadata.exit_code === "number") return metadata.exit_code !== 0;
  }
  return /^(error|failed|traceback|exception)\b/i.test(outputText.trim());
}

function elapsed(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

function clamp(value: string): string {
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}\n… [truncated]` : value;
}

function clip(value: string, length: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length > length ? `${single.slice(0, length)}…` : single;
}
