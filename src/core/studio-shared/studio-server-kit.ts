import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "fs-extra";
import { execa } from "execa";
import { findNearestRepository } from "../repository";

/**
 * DB Studio, AI Studio, and Tool Studio are separate Vite entry points built
 * into the SAME dist directory (see studio/vite.config.ts) — cheaper than a
 * dist folder per feature, and safe because Vite hashes each entry's asset
 * filenames independently. Each server only differs in which HTML file it
 * treats as its SPA-fallback root.
 */
export const STUDIO_DIST_DIRNAME = path.join("dist", "core", "db", "studio-dist");

export const STUDIO_MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

/**
 * Locate the built React Studio assets. Anchored to the CLI package root (not
 * `startDir` directly) so this resolves identically whether the CLI is
 * running compiled (`node dist/index.js`) or via `tsx src/index.ts`.
 */
export async function resolveStudioDistPath(startDir: string): Promise<string | undefined> {
  const repository = await findNearestRepository(startDir);
  if (!repository) return undefined;
  return path.join(repository.repositoryPath, STUDIO_DIST_DIRNAME);
}

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

export async function findAvailablePort(preferredPort: number): Promise<number> {
  for (let candidate = preferredPort; candidate < preferredPort + 50; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error(`No available port found between ${preferredPort} and ${preferredPort + 49}`);
}

export async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await execa(command, args, { reject: false, detached: true, stdio: "ignore" }).catch(() => undefined);
}

/**
 * Serve the built React Studio (SPA fallback: unknown paths without a file
 * extension resolve to `fallbackHtmlFileName`).
 */
export async function serveStudioAsset(options: {
  distPath: string | undefined;
  pathname: string;
  res: http.ServerResponse;
  fallbackHtmlFileName: string;
  notBuiltMessageHtml: string;
}): Promise<void> {
  const { distPath, pathname, res, fallbackHtmlFileName, notBuiltMessageHtml } = options;
  const requestedExt = path.extname(pathname);

  if (distPath && (await fs.pathExists(distPath))) {
    // Prevent path traversal: resolve then verify the result stays inside distPath.
    const relative = requestedExt ? pathname.replace(/^\/+/, "") : fallbackHtmlFileName;
    const resolved = path.normalize(path.join(distPath, relative));

    if (resolved === distPath || resolved.startsWith(distPath + path.sep)) {
      const filePath = (await fs.pathExists(resolved)) && (await fs.stat(resolved)).isFile()
        ? resolved
        : path.join(distPath, fallbackHtmlFileName);

      if (await fs.pathExists(filePath)) {
        const contentType = STUDIO_MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "content-type": contentType });
        res.end(await fs.readFile(filePath));
        return;
      }
    }
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(notBuiltMessageHtml);
}

export type TJsonBody = Record<string, unknown>;

export async function readJsonBody(req: http.IncomingMessage): Promise<TJsonBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as TJsonBody;
}

/** Read a raw (non-JSON) request body, for single-file uploads. Bounded by `maxBytes`. */
export async function readRawBody(req: http.IncomingMessage, maxBytes = 200 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`Upload exceeds the ${Math.round(maxBytes / (1024 * 1024))}MB limit.`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  const payload = JSON.stringify(value);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

export function sendText(res: http.ServerResponse, value: string, contentType: string, fileName?: string): void {
  const headers: Record<string, string> = { "content-type": contentType };
  if (fileName) headers["content-disposition"] = `attachment; filename="${fileName}"`;
  res.writeHead(200, headers);
  res.end(value);
}

export function getString(body: TJsonBody, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

export function getNumber(body: TJsonBody, key: string, fallback: number): number {
  const value = Number(body[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function getBoolean(body: TJsonBody, key: string, fallback = false): boolean {
  const value = body[key];
  return typeof value === "boolean" ? value : fallback;
}

export type TStudioLogFn = (message: string) => void;

/**
 * Reports one of a Studio server's startup status lines. Traditional CLI use
 * (`smdg ai studio` run directly, no `onLog` supplied) prints the colored
 * line straight to stdout, same as always. Inside the Ink shell, `onLog` is
 * the focused session's own managed sink (see StudioSessionScreen.tsx) —
 * calling `console.log` directly there would write straight to the real
 * terminal while Ink is independently redrawing it, corrupting the display
 * (this was a real bug: raw "SimpleMDG AI Studio: ..." lines and Node's own
 * process warnings landing mid-frame, outside any managed session view).
 */
export function reportStudioStartupLine(onLog: TStudioLogFn | undefined, plainMessage: string, colorize: (text: string) => string): void {
  if (onLog) {
    onLog(plainMessage);
    return;
  }
  console.log(colorize(plainMessage));
}
