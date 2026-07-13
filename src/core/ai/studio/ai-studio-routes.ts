import type http from "node:http";
import { analyzeSession, buildContinuationPrompt, deriveTurns } from "../ai-session-analysis";
import { computeAdvisor } from "../ai-session-advisor";
import { ingestAiSessions } from "../ai-session-ingestion";
import { redactSecrets } from "../ai-secret-redaction";
import { exportSession } from "../ai-session-export";
import { openProjectFolder, openProjectInVsCode, type TShellKind } from "../ai-session-command-service";
import { buildSessionLaunchResponse } from "../ai-session-launch";
import { getSessionLauncher } from "../launchers/claude-session-launcher";
import { aiStudioStorageDir } from "../ai-session-store";
import type { AiSessionStore } from "../ai-session-store";
import type { TAiObservation } from "../ai-types";

type TJsonBody = Record<string, unknown>;

function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

function sendText(res: http.ServerResponse, value: string, contentType: string, fileName?: string): void {
  const headers: Record<string, string> = { "content-type": contentType };
  if (fileName) headers["content-disposition"] = `attachment; filename="${fileName}"`;
  res.writeHead(200, headers);
  res.end(value);
}

async function readJsonBody(req: http.IncomingMessage): Promise<TJsonBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as TJsonBody;
  } catch {
    return {};
  }
}

function getString(body: TJsonBody, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

function redactObservation(observation: TAiObservation, reveal: boolean): TAiObservation {
  if (reveal) return observation;
  return { ...observation, input: redactSecrets(observation.input), output: redactSecrets(observation.output) };
}

/**
 * Handles every `/api/ai/*` route. Returns true if the request was handled (regardless of whether
 * that resulted in an error response), false if the path didn't match anything here.
 */
export async function handleAiStudioApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, store: AiSessionStore | undefined): Promise<boolean> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (!pathname.startsWith("/api/ai/")) return false;

  if (!store) {
    sendJson(res, { error: "AI Studio requires Node.js 22.5+ for its local SQLite store (node:sqlite). Upgrade Node and re-run `smdg ai studio`." }, 503);
    return true;
  }

  if (pathname === "/api/ai/overview" && method === "GET") {
    sendJson(res, store.overview());
    return true;
  }

  if (pathname === "/api/ai/projects" && method === "GET") {
    sendJson(res, { projects: store.listProjects() });
    return true;
  }

  if (pathname === "/api/ai/doctor" && method === "GET") {
    sendJson(res, {
      claudeFilesIngested: store.countIngestedFiles("claude"),
      codexFilesIngested: store.countIngestedFiles("codex"),
      totalSessions: store.countSessions(),
      diagnostics: store.listDiagnostics(200),
      storageDir: aiStudioStorageDir(),
    });
    return true;
  }

  if (pathname === "/api/ai/refresh" && method === "POST") {
    const result = await ingestAiSessions(store);
    sendJson(res, result);
    return true;
  }

  if (pathname === "/api/ai/sessions" && method === "GET") {
    const params = url.searchParams;
    const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || 50));
    const result = store.listSessions({
      filter: {
        provider: params.get("provider") || undefined,
        project: params.get("project") || undefined,
        search: params.get("search") || undefined,
        hasErrors: params.get("hasErrors") === "true",
        pinnedOnly: params.get("pinnedOnly") === "true",
      },
      cursor: params.get("cursor") || undefined,
      limit,
    });
    sendJson(res, result);
    return true;
  }

  const sessionMatch = pathname.match(/^\/api\/ai\/sessions\/([^/]+)(\/.*)?$/);
  if (sessionMatch) {
    const sessionId = decodeURIComponent(sessionMatch[1]);
    const subPath = sessionMatch[2] ?? "";
    const session = store.getSession(sessionId);

    if (!session) {
      sendJson(res, { error: `Session not found: ${sessionId}` }, 404);
      return true;
    }

    if (subPath === "" && method === "GET") {
      sendJson(res, { session });
      return true;
    }

    if (subPath === "/turns" && method === "GET") {
      const reveal = url.searchParams.get("reveal") === "true";
      const observations = store.getObservations(sessionId);
      const turns = deriveTurns(observations).map((turn) => (reveal ? turn : { ...turn, userRequest: redactSecrets(turn.userRequest) }));
      sendJson(res, { turns });
      return true;
    }

    if (subPath === "/observations" && method === "GET") {
      const reveal = url.searchParams.get("reveal") === "true";
      const turnIndexParam = url.searchParams.get("turnIndex");
      let observations = store.getObservations(sessionId);
      if (turnIndexParam !== null) {
        const turns = deriveTurns(observations);
        const turn = turns.find((candidate) => candidate.index === Number(turnIndexParam));
        const turnStart = turn ? Date.parse(turn.startedAt) : NaN;
        const turnEnd = turn?.endedAt ? Date.parse(turn.endedAt) : turnStart;
        observations = turn
          ? observations.filter((observation) => {
              const time = Date.parse(observation.startedAt);
              return Number.isFinite(time) && time >= turnStart && time <= turnEnd + 1;
            })
          : [];
      }
      sendJson(res, { observations: observations.map((observation) => redactObservation(observation, reveal)) });
      return true;
    }

    if (subPath === "/analysis" && method === "GET") {
      const observations = store.getObservations(sessionId);
      sendJson(res, analyzeSession(sessionId, observations));
      return true;
    }

    if (subPath === "/advisor" && method === "GET") {
      const children = store.listChildSessions(sessionId);
      const observations = store.getObservations(sessionId);
      sendJson(res, computeAdvisor(session, children, observations));
      return true;
    }

    if (subPath === "/score" && method === "POST") {
      const body = await readJsonBody(req);
      const value = getString(body, "value");
      if (value !== "good" && value !== "bad") {
        sendJson(res, { error: "value must be 'good' or 'bad'" }, 400);
        return true;
      }
      store.setScore(sessionId, value);
      sendJson(res, { ok: true });
      return true;
    }

    if (subPath === "/pin" && method === "POST") {
      const body = await readJsonBody(req);
      store.setFlag(sessionId, "pinned", body.value !== false);
      sendJson(res, { ok: true });
      return true;
    }

    if (subPath === "/favorite" && method === "POST") {
      const body = await readJsonBody(req);
      store.setFlag(sessionId, "favorite", body.value !== false);
      sendJson(res, { ok: true });
      return true;
    }

    if (subPath === "/launch" && method === "GET") {
      const shell = (url.searchParams.get("shell") as TShellKind | null) ?? undefined;
      const launch = await buildSessionLaunchResponse(session, shell ?? undefined);
      sendJson(res, launch);
      return true;
    }

    if (subPath === "/open-terminal" && method === "POST") {
      const launcher = getSessionLauncher(session.provider);
      if (!launcher) {
        sendJson(res, { ok: false, error: `Resuming ${session.provider} sessions is not supported yet.` });
        return true;
      }
      const body = await readJsonBody(req);
      const mode = getString(body, "mode") === "continue" ? "continue" : "resume";
      const result = mode === "continue" ? await launcher.openContinueInTerminal(session) : await launcher.openInTerminal(session);
      sendJson(res, result);
      return true;
    }

    if (subPath === "/open-project" && method === "POST") {
      const result = await openProjectFolder(session.cwd);
      sendJson(res, result);
      return true;
    }

    if (subPath === "/open-vscode" && method === "POST") {
      const result = await openProjectInVsCode(session.cwd);
      sendJson(res, result);
      return true;
    }

    if (subPath === "/continuation-prompt" && method === "GET") {
      const observations = store.getObservations(sessionId);
      const turns = deriveTurns(observations);
      const analysis = analyzeSession(sessionId, observations);
      sendJson(res, { prompt: buildContinuationPrompt(session, turns, analysis) });
      return true;
    }

    if (subPath === "/export" && (method === "POST" || method === "GET")) {
      const format = (method === "GET" ? url.searchParams.get("format") : getString(await readJsonBody(req), "format")) === "json" ? "json" : "markdown";
      const observations = store.getObservations(sessionId);
      const turns = deriveTurns(observations);
      const analysis = analyzeSession(sessionId, observations);
      const redacted = observations.map((observation) => redactObservation(observation, false));
      const exported = exportSession({ session, turns, observations: redacted, analysis }, format);
      sendText(res, exported.content, exported.mimeType, `${sanitizeFileName(session.title)}.${exported.extension}`);
      return true;
    }
  }

  sendJson(res, { error: "Not found" }, 404);
  return true;
}

function sanitizeFileName(name: string): string {
  return (name || "session").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}
