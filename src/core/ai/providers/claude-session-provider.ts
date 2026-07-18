import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import fg from "fast-glob";
import type { IAiSessionProvider, TAiObservation, TAiObservationType, TParsedAiSession, TSessionFile } from "../ai-types";

const MAX_FIELD_LENGTH = 20000;

export function claudeProjectsRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

/**
 * Parses Claude Code's `~/.claude/projects/**\/*.jsonl` transcripts. Each line is a JSON record;
 * unrecognized record types (queue-operation, etc.) are silently skipped rather than treated as
 * errors, since Claude Code's format is not a documented stable contract.
 */
export class ClaudeSessionProvider implements IAiSessionProvider {
  readonly id = "claude" as const;

  async discoverSessionFiles(): Promise<TSessionFile[]> {
    const root = claudeProjectsRoot();
    if (!(await fs.pathExists(root))) return [];

    const files = await fg("**/*.jsonl", { cwd: root, absolute: true, followSymbolicLinks: false });
    const results: TSessionFile[] = [];
    for (const file of files) {
      try {
        const stat = await fs.stat(file);
        results.push({ path: file, provider: "claude", modifiedAtMs: stat.mtimeMs, sizeBytes: stat.size });
      } catch {
        // Deleted between glob and stat; skip.
      }
    }
    return results;
  }

  parseSession(file: TSessionFile, content: string): TParsedAiSession | undefined {
    return parseClaudeSession(file.path, content);
  }
}

export function parseClaudeSession(filePath: string, content: string): TParsedAiSession | undefined {
  const observations: TAiObservation[] = [];
  const pendingTools = new Map<string, TAiObservation>();
  const seenUsageIds = new Set<string>();
  // Subagent transcripts live in `<project>/<session-id>/subagents/agent-<agentId>.jsonl` and carry
  // the parent's sessionId; capturing the agentId keeps their session id distinct from the parent's.
  const subagentId = filePath.match(/[\\/]subagents[\\/]agent-([^\\/]+)\.jsonl$/i)?.[1] ?? "";

  let sessionId = "";
  let cwd = "";
  let model = "";
  let title = "";
  let summaryTitle = "";
  let gitBranch = "";
  let firstAt = "";
  let lastAt = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let liveContextTokens = 0;
  let pendingObsTokens = 0;
  let userIdx = -1;
  let assistantIdx = -1;

  for (const line of jsonLines(content)) {
    const timestamp = str(line.timestamp);
    if (timestamp) {
      firstAt = firstAt || timestamp;
      lastAt = timestamp;
    }
    sessionId = sessionId || str(line.sessionId);
    cwd = cwd || str(line.cwd);
    gitBranch = gitBranch || str(line.gitBranch);

    if (line.type === "summary" && str(line.summary)) {
      summaryTitle = str(line.summary);
      continue;
    }

    const message = obj(line.message);
    const sidechain = line.isSidechain === true;

    if (line.type === "user" && !line.isMeta) {
      const blocks = Array.isArray(message.content) ? message.content : [{ type: "text", text: str(message.content) }];
      for (const rawBlock of blocks) {
        const block = obj(rawBlock);
        if (block.type === "text") {
          const text = str(block.text).trim();
          const command = text.match(/<command-name>([\s\S]*?)<\/command-name>/);
          if (command) {
            const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim() ?? "";
            userIdx = observations.length;
            assistantIdx = -1;
            observations.push(makeObservation(userIdx, "command", command[1].trim() || "command", timestamp, args, "", 0, sidechain));
            continue;
          }
          const stdout = text.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
          if (stdout) {
            for (let i = observations.length - 1; i >= 0; i -= 1) {
              if (observations[i].type === "command") {
                observations[i].output = clamp(stdout[1].trim());
                break;
              }
            }
            continue;
          }
          if (!text || text.startsWith("<")) continue;
          // Auto-compaction re-injects a synthetic "This session is being continued from a
          // previous conversation..." user message (marked `isCompactSummary`) to carry the
          // pre-compaction summary forward. It's real conversation content worth keeping as an
          // observation (and a useful "current context starts here" marker — see metadata below),
          // but it was never typed by a human, so it must never win the title fallback below.
          const isCompactBoundary = line.isCompactSummary === true;
          if (!isCompactBoundary) title = title || text;
          userIdx = observations.length;
          assistantIdx = -1;
          const userObs = makeObservation(userIdx, "user", "user", timestamp, text, "", 0, sidechain);
          if (isCompactBoundary) userObs.metadata = JSON.stringify({ compactBoundary: true });
          observations.push(userObs);
        } else if (block.type === "tool_result") {
          const pending = pendingTools.get(str(block.tool_use_id));
          if (pending) {
            pending.output = clamp(textOf(block.content));
            pending.durationMs = elapsed(pending.startedAt, timestamp);
            const audit: Record<string, unknown> = {};
            if (pending.metadata === "__subagent__") {
              // The launched agent's id links to its separate subagent transcript file
              // (claude:<session>:agent:<id>). It lives structured on `toolUseResult`, a sibling
              // of `message` on this same JSONL record (Claude Code's own metadata, not part of
              // the API message the model saw) — far more reliable than the free-text result the
              // model itself received, which doesn't consistently mention the id at all. The regex
              // fallback is kept for any transcript shape where `toolUseResult` is absent.
              const agentId = str(obj(line.toolUseResult).agentId) || pending.output.match(/agentId:\s*['"]?([a-z0-9]{6,})/i)?.[1];
              if (agentId) audit.agentId = agentId;
            }
            if (block.is_error === true) {
              audit.error = true;
              pending.isError = true;
            }
            pending.metadata = Object.keys(audit).length ? JSON.stringify(audit) : "";
            pendingTools.delete(str(block.tool_use_id));
          }
        }
      }
    }

    if (line.type === "assistant") {
      model = str(message.model) || model;
      const messageId = str(message.id);
      const usage = obj(message.usage);
      if (messageId && !seenUsageIds.has(messageId) && Object.keys(usage).length) {
        seenUsageIds.add(messageId);
        inputTokens += num(usage.input_tokens) + num(usage.cache_creation_input_tokens);
        outputTokens += num(usage.output_tokens);
        cacheReadTokens += num(usage.cache_read_input_tokens);
        cacheCreationTokens += num(usage.cache_creation_input_tokens);
        pendingObsTokens = num(usage.output_tokens);
        // Overwritten (not accumulated) on every message, so once parsing finishes this holds the
        // *last* turn's total context size — see the `liveContextTokens` field doc in ai-types.ts.
        liveContextTokens = num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens) + num(usage.output_tokens);
      }

      // Claude reports `usage` once per *message*, not per content block — the previous logic
      // attributed it only to a message's first text block, so any message that was thinking/
      // tool-calls only (no text at all, which is common) silently dropped its output-token count
      // from every per-observation and per-turn sum, even though it's still folded into the
      // session-level `outputTokens` total above. That's exactly why turn-level token sums never
      // matched the session total. Fix: attribute the whole message's tokens to whichever
      // observation this message produces *first* (text, thinking, or a tool call — whatever
      // appears first in `blocks`), exactly once, so per-observation sums always equal the total.
      const messageTokens = pendingObsTokens;
      pendingObsTokens = 0;
      let tokensAssigned = false;
      const takeTokens = (): number => {
        if (tokensAssigned) return 0;
        tokensAssigned = true;
        return messageTokens;
      };

      const blocks = Array.isArray(message.content) ? message.content : [];
      for (const rawBlock of blocks) {
        const block = obj(rawBlock);
        if (block.type === "text" && str(block.text).trim()) {
          assistantIdx = observations.length;
          observations.push(makeObservation(assistantIdx, "assistant", "assistant", timestamp, "", str(block.text), takeTokens(), sidechain, userIdx));
        } else if (block.type === "thinking") {
          // Extended thinking can come back "redacted" — `thinking` is an empty string and only an
          // opaque `signature` is present — yet the model still spent real output tokens producing
          // it. Always create the observation (with a placeholder when there's nothing visible to
          // show) so those tokens always land somewhere, instead of vanishing from every
          // per-observation/per-turn sum while still counting toward the session total above.
          const thinkingText = str(block.thinking).trim();
          observations.push(
            makeObservation(
              observations.length,
              "reasoning",
              "thinking",
              timestamp,
              "",
              thinkingText || "(redacted — extended thinking content not exposed in the transcript)",
              takeTokens(),
              sidechain,
              assistantIdx >= 0 ? assistantIdx : userIdx,
            ),
          );
        } else if (block.type === "tool_use") {
          const toolName = str(block.name) || "tool";
          const bin = obj(block.input);
          let name = toolName;
          let type: TAiObservationType = "tool-call";
          let isSubagentMarker = false;
          if (toolName === "Skill") {
            type = "skill";
            name = str(bin.skill) || "Skill";
          } else if (toolName === "Agent" || toolName === "Task") {
            type = "subagent";
            name = str(bin.subagent_type) || "subagent";
            isSubagentMarker = true;
          } else if (toolName === "Bash" || toolName === "PowerShell") {
            type = "shell-command";
          } else if (toolName.startsWith("mcp__")) {
            type = "mcp-call";
          }
          const parentIdx = assistantIdx >= 0 ? assistantIdx : userIdx;
          const tool = makeObservation(observations.length, type, name, timestamp, JSON.stringify(block.input ?? {}, null, 2), "", takeTokens(), sidechain, parentIdx);
          if (isSubagentMarker) tool.metadata = "__subagent__";
          observations.push(tool);
          pendingTools.set(str(block.id), tool);
        }
      }
    }
  }

  if (!sessionId) return undefined;

  const id = subagentId ? `claude:${sessionId}:agent:${subagentId}` : `claude:${sessionId}`;
  for (const obsItem of observations) {
    if (obsItem.metadata === "__subagent__") obsItem.metadata = "";
  }
  return buildParsedSession({
    id,
    provider: "claude",
    cwd,
    fallbackProject: path.basename(path.dirname(filePath)),
    title: summaryTitle || title,
    model,
    firstAt,
    lastAt,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    liveContextTokens,
    file: filePath,
    gitBranch,
    parentSessionId: subagentId ? `claude:${sessionId}` : undefined,
    observations,
  });
}

function buildParsedSession(input: {
  id: string;
  provider: "claude";
  cwd: string;
  fallbackProject: string;
  title: string;
  model: string;
  firstAt: string;
  lastAt: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  liveContextTokens: number;
  file: string;
  gitBranch: string;
  parentSessionId?: string;
  observations: TAiObservation[];
}): TParsedAiSession {
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
      title: clip(input.title, 500) || input.id,
      model: input.model,
      gitBranch: input.gitBranch || undefined,
      startedAt: input.firstAt,
      endedAt: input.lastAt,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      cacheReadTokens: input.cacheReadTokens,
      cacheCreationTokens: input.cacheCreationTokens,
      liveContextTokens: input.liveContextTokens,
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
    // Parent idx is resolved to a full observation id in buildParsedSession, once the session id is known.
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

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => (typeof item === "string" ? item : str(obj(item).text) || JSON.stringify(item))).join("\n");
  if (value && typeof value === "object") {
    const inner = obj(value);
    return str(inner.text) || str(inner.output) || str(inner.content) || JSON.stringify(value);
  }
  return "";
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
