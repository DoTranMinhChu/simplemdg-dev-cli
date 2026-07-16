import http from "node:http";
import chalk from "chalk";
import { getDirname } from "../../esm-paths";
import {
  findAvailablePort,
  openBrowser,
  resolveStudioDistPath,
  serveStudioAsset as serveStudioAssetFromKit,
} from "../../studio-shared/studio-server-kit";
import { AiSessionStore } from "../ai-session-store";
import { ingestAiSessions, watchAiSessions } from "../ai-session-ingestion";
import { handleAiStudioApi } from "./ai-studio-routes";
import { handlePluginsApi } from "./plugins-routes";

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
const AI_STUDIO_HTML = "ai-studio.html";

const __dirname = getDirname(import.meta.url);

const AI_STUDIO_NOT_BUILT_HTML =
  "<!doctype html><html><body style=\"font-family:sans-serif;padding:40px;color:#334\"><h2>AI Studio UI is not built</h2>" +
  "<p>Run <code>npm run build:studio</code> (or <code>npm run build</code>) from the repository root, then restart <code>smdg ai studio</code>.</p></body></html>";

async function serveAiStudioAsset(pathname: string, res: http.ServerResponse): Promise<void> {
  await serveStudioAssetFromKit({
    distPath: await resolveStudioDistPath(__dirname),
    pathname,
    res,
    fallbackHtmlFileName: AI_STUDIO_HTML,
    notBuiltMessageHtml: AI_STUDIO_NOT_BUILT_HTML,
  });
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

        // Plugin management is independent of the SQLite store — it must keep working on
        // Node < 22.5, where handleAiStudioApi 503s every /api/ai/* route.
        const handled = (await handleAiStudioApi(req, res, url, store)) || (await handlePluginsApi(req, res, url));
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
