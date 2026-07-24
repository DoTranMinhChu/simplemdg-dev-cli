import http from "node:http";
import chalk from "chalk";
import { getDirname } from "../../esm-paths";
import {
  findAvailablePort,
  openBrowser,
  reportStudioStartupLine,
  resolveStudioDistPath,
  sendJson,
  serveStudioAsset as serveStudioAssetFromKit,
  type TStudioLogFn,
} from "../../studio-shared/studio-server-kit";
import { onCacheEvent } from "../../cache/smart-cache";
import { onJobEvent } from "./job-events";
import { handleTestConfigApi } from "./routes/test-config-routes";
import { handleBtpTargetApi } from "./routes/btp-target-routes";
import { handleCfLogRestartApi } from "./routes/cf-log-restart-routes";
import { handleCheckApiApi } from "./routes/check-api-routes";
import { handleCpiQueueApi } from "./routes/cpi-queue-routes";
import { handleJiraApi } from "./routes/jira-routes";
import { handleIncidentApi } from "./routes/incident-routes";
import { handleDeployModelApi } from "./routes/deploy-model-routes";
import { handleCustomModelApi } from "./routes/custom-model-routes";
import { handleDeployTargetApi } from "./routes/deploy-target-routes";
import { handleNpmrcApi } from "./routes/npmrc-routes";

export type TToolStudioServerOptions = {
  port?: number;
  apiOnly?: boolean;
  onLog?: TStudioLogFn;
};

export type TToolStudioServerHandle = {
  url: string;
  port: number;
  close: () => Promise<void>;
};

const TOOL_STUDIO_HTML = "tool-studio.html";
const __dirname = getDirname(import.meta.url);

const TOOL_STUDIO_NOT_BUILT_HTML =
  "<!doctype html><html><body style=\"font-family:sans-serif;padding:40px;color:#334\"><h2>Tool Studio UI is not built</h2>" +
  "<p>Run <code>npm run build:studio</code> (or <code>npm run build</code>) from the repository root, then restart <code>smdg tool studio</code>.</p></body></html>";

async function serveToolStudioAsset(pathname: string, res: http.ServerResponse): Promise<void> {
  await serveStudioAssetFromKit({
    distPath: await resolveStudioDistPath(__dirname),
    pathname,
    res,
    fallbackHtmlFileName: TOOL_STUDIO_HTML,
    notBuiltMessageHtml: TOOL_STUDIO_NOT_BUILT_HTML,
  });
}

/**
 * Router composition: one `handle*Api` per feature, first `true` return wins.
 * As more of the plan lands (Deploy Model, Check API External, Jira, ...)
 * their route modules are added to this list — the server itself never grows.
 */
const API_HANDLERS: Array<(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string) => Promise<boolean>> = [
  handleBtpTargetApi,
  handleCfLogRestartApi,
  handleCheckApiApi,
  handleCpiQueueApi,
  handleJiraApi,
  handleIncidentApi,
  handleDeployModelApi,
  handleCustomModelApi,
  handleDeployTargetApi,
  handleNpmrcApi,
  handleTestConfigApi,
];

export async function startToolStudioServer(options: TToolStudioServerOptions = {}): Promise<TToolStudioServerHandle> {
  const preferredPort = options.port && options.port > 0 ? options.port : 45890;
  const port = await findAvailablePort(preferredPort);

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
        const pathname = url.pathname;
        const method = req.method ?? "GET";

        // Server-Sent Events: smart-cache refreshes + long-running job progress,
        // multiplexed over one connection (discriminated by `channel` on the wire).
        if (pathname === "/api/tool/events" && method === "GET") {
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(": connected\n\n");
          const unsubscribeJobs = onJobEvent((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
          // The "cache" side of the multiplex documented above — BtpTargetSelector/BtpAppSelector
          // (shared with DB Studio, which streams these same bare events over its own /api/events)
          // subscribe to background cf-apps/cf-cross-region-target refreshes to auto-reload without
          // a manual click. Tagged `channel: "cache"` only here (DB Studio's stream stays untagged/
          // unchanged) so useJobEvents' `channel === "job"` filter on this same connection ignores them.
          const unsubscribeCache = onCacheEvent((event) => res.write(`data: ${JSON.stringify({ ...event, channel: "cache" })}\n\n`));
          const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);
          req.on("close", () => {
            clearInterval(keepAlive);
            unsubscribeJobs();
            unsubscribeCache();
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
          await serveToolStudioAsset(pathname, res);
          return;
        }

        if (method === "GET" && !pathname.startsWith("/api/") && !options.apiOnly) {
          await serveToolStudioAsset(pathname, res);
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
    reportStudioStartupLine(options.onLog, `SimpleMDG Tool Studio API: ${url}`, chalk.green);
    reportStudioStartupLine(options.onLog, "Running in --api-only mode (no UI is served here).", chalk.gray);
    reportStudioStartupLine(options.onLog, "In another terminal, run:", chalk.gray);
    reportStudioStartupLine(options.onLog, "  cd studio && npm run dev", chalk.cyan);
    reportStudioStartupLine(options.onLog, `Vite will proxy /api/tool to ${url}.`, chalk.gray);
  } else {
    reportStudioStartupLine(options.onLog, `SimpleMDG Tool Studio: ${url}`, chalk.green);
  }
  reportStudioStartupLine(options.onLog, "Server is bound to 127.0.0.1 only. Press Ctrl+C to stop.", chalk.gray);

  if (!options.apiOnly && !process.env.SMDG_TOOL_STUDIO_NO_OPEN) {
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
