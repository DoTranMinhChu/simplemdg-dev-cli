import http from "node:http";
import net from "node:net";
import path from "node:path";
import fs from "fs-extra";
import chalk from "chalk";
import { execa } from "execa";
import { findNearestRepository } from "../../repository";
import { getDirname } from "../../esm-paths";
import { AiSessionStore } from "../ai-session-store";
import { ingestAiSessions, watchAiSessions } from "../ai-session-ingestion";
import { handleAiStudioApi } from "./ai-studio-routes";

export type TAiStudioServerOptions = {
  port?: number;
  apiOnly?: boolean;
};

export type TAiStudioServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

// The React app is built as a second Vite entry point alongside DB Studio's, into the SAME
// dist/core/db/studio-dist directory (see studio/vite.config.ts) — cheaper than a second dist
// folder, and safe because Vite hashes each entry's asset filenames independently. This server
// just requests ai-studio.html as its SPA-fallback root instead of index.html.
const STUDIO_DIST_DIRNAME = path.join("dist", "core", "db", "studio-dist");
const AI_STUDIO_HTML = "ai-studio.html";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const __dirname = getDirname(import.meta.url);

async function resolveStudioDistPath(): Promise<string | undefined> {
  const repository = await findNearestRepository(__dirname);
  if (!repository) return undefined;
  return path.join(repository.repositoryPath, STUDIO_DIST_DIRNAME);
}

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => tester.close(() => resolve(true)))
      .listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(preferredPort: number): Promise<number> {
  for (let candidate = preferredPort; candidate < preferredPort + 50; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error(`No available port found between ${preferredPort} and ${preferredPort + 49}`);
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  await execa(command, args, { reject: false, detached: true, stdio: "ignore" }).catch(() => undefined);
}

async function serveAiStudioAsset(pathname: string, res: http.ServerResponse): Promise<void> {
  const distPath = await resolveStudioDistPath();
  const requestedExt = path.extname(pathname);

  if (distPath && (await fs.pathExists(distPath))) {
    const relative = requestedExt ? pathname.replace(/^\/+/, "") : AI_STUDIO_HTML;
    const resolved = path.normalize(path.join(distPath, relative));

    if (resolved === distPath || resolved.startsWith(distPath + path.sep)) {
      const filePath = (await fs.pathExists(resolved)) && (await fs.stat(resolved)).isFile() ? resolved : path.join(distPath, AI_STUDIO_HTML);
      if (await fs.pathExists(filePath)) {
        const contentType = MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "content-type": contentType });
        res.end(await fs.readFile(filePath));
        return;
      }
    }
  }

  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    "<!doctype html><html><body style=\"font-family:sans-serif;padding:40px;color:#334\"><h2>AI Studio UI is not built</h2>" +
      "<p>Run <code>npm run build:studio</code> (or <code>npm run build</code>) from the repository root, then restart <code>smdg ai studio</code>.</p></body></html>",
  );
}

export async function startAiStudioServer(options: TAiStudioServerOptions = {}): Promise<TAiStudioServerHandle> {
  const preferredPort = options.port && options.port > 0 ? options.port : 45889;
  const port = await findAvailablePort(preferredPort);
  const store = await AiSessionStore.open();

  if (store) {
    // Ingest once on startup so the first page load already has data, then keep watching for
    // live session activity (debounced) so Studio updates without a manual refresh.
    await ingestAiSessions(store).catch(() => undefined);
  }
  const watcher = store
    ? watchAiSessions(() => {
        void ingestAiSessions(store).catch(() => undefined);
      })
    : undefined;

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        const pathname = url.pathname;
        const method = req.method ?? "GET";

        const handled = await handleAiStudioApi(req, res, url, store);
        if (handled) return;

        if (pathname === "/" && method === "GET") {
          if (options.apiOnly) {
            res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "This server is running in --api-only mode." }));
            return;
          }
          await serveAiStudioAsset(pathname, res);
          return;
        }

        if (method === "GET" && !pathname.startsWith("/api/") && !options.apiOnly) {
          await serveAiStudioAsset(pathname, res);
          return;
        }

        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Not found" }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: message }));
        } else {
          res.end();
        }
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const url = `http://127.0.0.1:${port}`;
  console.log(chalk.green(`SimpleMDG AI Studio: ${url}`));
  if (!store) {
    console.log(chalk.yellow("node:sqlite is unavailable (requires Node.js 22.5+). Sessions cannot be stored; upgrade Node and restart."));
  }
  console.log(chalk.gray("Server is bound to 127.0.0.1 only. Press Ctrl+C to stop."));

  if (!options.apiOnly && !process.env.SMDG_AI_STUDIO_NO_OPEN) {
    await openBrowser(url);
  }

  return {
    url,
    port,
    close: async () => {
      watcher?.dispose();
      store?.close();
      // server.close()'s callback only fires once every open socket disconnects — the
      // browser tab opened by openBrowser() holds a keep-alive connection, so without
      // forcing existing sockets closed this would hang forever and Ctrl+C would never exit.
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
