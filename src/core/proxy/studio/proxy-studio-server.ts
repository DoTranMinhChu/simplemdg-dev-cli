import http from "node:http";
import chalk from "chalk";
import { getDirname } from "../../esm-paths";
import {
  findAvailablePort,
  openBrowser,
  resolveStudioDistPath,
  sendJson,
  serveStudioAsset as serveStudioAssetFromKit,
} from "../../studio-shared/studio-server-kit";
import { onProxyLogEvent, onProxyStatusEvent } from "./proxy-events";
import { handleEnvironmentsApi } from "./routes/environments-routes";
import { handleProxyLifecycleApi } from "./routes/proxy-lifecycle-routes";
import { handleQuickProxyApi } from "./routes/quick-proxy-routes";
import { handlePortsApi } from "./routes/ports-routes";

export type TProxyStudioServerOptions = {
  port?: number;
  apiOnly?: boolean;
};

export type TProxyStudioServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

const PROXY_STUDIO_HTML = "proxy-studio.html";
const __dirname = getDirname(import.meta.url);

const PROXY_STUDIO_NOT_BUILT_HTML =
  "<!doctype html><html><body style=\"font-family:sans-serif;padding:40px;color:#334\"><h2>Proxy Studio UI is not built</h2>" +
  "<p>Run <code>npm run build:studio</code> (or <code>npm run build</code>) from the repository root, then restart <code>smdg proxy studio</code>.</p></body></html>";

async function serveProxyStudioAsset(pathname: string, res: http.ServerResponse): Promise<void> {
  await serveStudioAssetFromKit({
    distPath: await resolveStudioDistPath(__dirname),
    pathname,
    res,
    fallbackHtmlFileName: PROXY_STUDIO_HTML,
    notBuiltMessageHtml: PROXY_STUDIO_NOT_BUILT_HTML,
  });
}

/** Router composition: one `handle*Api` per feature, first `true` return wins — same convention as Tool Studio. */
const API_HANDLERS: Array<(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string) => Promise<boolean>> = [
  handleEnvironmentsApi,
  handleProxyLifecycleApi,
  handleQuickProxyApi,
  handlePortsApi,
];

export async function startProxyStudioServer(options: TProxyStudioServerOptions = {}): Promise<TProxyStudioServerHandle> {
  const preferredPort = options.port && options.port > 0 ? options.port : 45891;
  const port = await findAvailablePort(preferredPort);

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        const pathname = url.pathname;
        const method = req.method ?? "GET";

        // Server-Sent Events: proxy status + log streaming, multiplexed over one connection.
        if (pathname === "/api/proxy/events" && method === "GET") {
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(": connected\n\n");
          const unsubscribeStatus = onProxyStatusEvent((event) => res.write(`data: ${JSON.stringify({ ...event, channel: "status" })}\n\n`));
          const unsubscribeLogs = onProxyLogEvent((event) => res.write(`data: ${JSON.stringify({ ...event, channel: "log" })}\n\n`));
          const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
          req.on("close", () => {
            clearInterval(keepAlive);
            unsubscribeStatus();
            unsubscribeLogs();
          });
          return;
        }

        for (const handler of API_HANDLERS) {
          if (await handler(req, res, url, method)) return;
        }

        if (pathname === "/" && method === "GET") {
          if (options.apiOnly) {
            sendJson(res, { error: "This server is running in --api-only mode. Start the Vite dev server separately: cd studio && npm run dev" }, 404);
            return;
          }
          await serveProxyStudioAsset(pathname, res);
          return;
        }

        if (method === "GET" && !pathname.startsWith("/api/") && !options.apiOnly) {
          await serveProxyStudioAsset(pathname, res);
          return;
        }

        sendJson(res, { error: "Not found" }, 404);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!res.headersSent) {
          sendJson(res, { error: message }, 500);
        } else {
          res.end();
        }
      }
    })();
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

  const url = `http://127.0.0.1:${port}`;

  if (options.apiOnly) {
    console.log(chalk.green(`SimpleMDG Proxy Studio API: ${url}`));
    console.log(chalk.gray("Running in --api-only mode (no UI is served here)."));
    console.log(chalk.gray("In another terminal, run:"));
    console.log(chalk.cyan("  cd studio && npm run dev"));
    console.log(chalk.gray(`Vite will proxy /api/proxy to ${url}.`));
  } else {
    console.log(chalk.green(`SimpleMDG Proxy Studio: ${url}`));
  }
  console.log(chalk.gray("Server is bound to 127.0.0.1 only. Press Ctrl+C to stop."));

  if (!options.apiOnly && !process.env.SMDG_PROXY_STUDIO_NO_OPEN) {
    await openBrowser(url);
  }

  return {
    url,
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
