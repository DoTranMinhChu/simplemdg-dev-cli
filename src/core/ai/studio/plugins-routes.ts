import type http from "node:http";
import { runPluginDoctor } from "../../plugins/plugin-doctor";
import { PluginCycleError, PluginNotFoundError } from "../../plugins/plugin-graph";
import { buildInstallPlan, executeInstallPlan, uninstallPlugin, updateInstalledPlugin } from "../../plugins/plugin-installer";
import { getPluginUsage, loadPluginRegistry } from "../../plugins/plugin-registry";
import { readAllInstalled } from "../../plugins/plugin-state-store";
import { findStudioExtensionInstance, listStudioExtensionFiles, listStudioExtensionInstances, readStudioExtensionFile } from "../../plugins/studio-extension-resolver";
import type { TInstallScope } from "../../plugins/plugin-types";
import { readJsonBody, sendJson } from "./studio-http-helpers";

const PREFIX = "/api/plugins";

const FILE_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
};

function parseScope(value: unknown): TInstallScope | undefined {
  return value === "user" || value === "project" ? value : undefined;
}

function parseProjectRoot(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Handles every `/api/plugins/*` route. Independent of `AiSessionStore` / `node:sqlite` — plugin
 * management works even on Node < 22.5, where the rest of AI Studio's API is unavailable. Returns
 * true if the request was handled (regardless of whether that produced an error response). */
export async function handlePluginsApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<boolean> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";

  if (!pathname.startsWith(PREFIX)) return false;

  const segments = pathname.slice(PREFIX.length).split("/").filter(Boolean);
  const params = url.searchParams;

  try {
    if (segments.length === 0 && method === "GET") {
      const projectRoot = parseProjectRoot(params.get("projectRoot"));
      const registry = await loadPluginRegistry();
      const installed = await readAllInstalled(projectRoot);
      const installedById = new Map(installed.map((record) => [record.pluginId, record]));

      sendJson(res, {
        plugins: [...registry.values()].map((manifest) => {
          const record = installedById.get(manifest.id);
          return { manifest, installed: record ? { scope: record.scope, version: record.version } : null };
        }),
      });
      return true;
    }

    if (segments.length === 1 && segments[0] === "doctor" && method === "GET") {
      sendJson(res, await runPluginDoctor(parseProjectRoot(params.get("projectRoot"))));
      return true;
    }

    if (segments.length === 2 && segments[0] === "registry" && method === "GET") {
      const registry = await loadPluginRegistry();
      const manifest = registry.get(segments[1]);
      if (!manifest) {
        sendJson(res, { error: "Plugin not found" }, 404);
        return true;
      }
      sendJson(res, { manifest, usage: (await getPluginUsage(segments[1])) ?? null });
      return true;
    }

    if (segments.length === 1 && segments[0] === "plan" && method === "POST") {
      const body = await readJsonBody(req);
      const plan = await buildInstallPlan(parseIds(body.ids), parseScope(body.scope) ?? "user", parseProjectRoot(body.projectRoot));
      sendJson(res, { plan });
      return true;
    }

    if (segments.length === 1 && segments[0] === "install" && method === "POST") {
      const body = await readJsonBody(req);
      const scope = parseScope(body.scope) ?? "user";
      const projectRoot = parseProjectRoot(body.projectRoot);
      const plan = await buildInstallPlan(parseIds(body.ids), scope, projectRoot);
      await executeInstallPlan(plan, scope, projectRoot, { force: body.force === true });
      sendJson(res, { plan });
      return true;
    }

    if (segments.length === 2 && segments[1] === "remove" && method === "POST") {
      const body = await readJsonBody(req);
      const result = await uninstallPlugin(segments[0], { projectRoot: parseProjectRoot(body.projectRoot), forceCascade: body.forceCascade === true });
      sendJson(res, result);
      return true;
    }

    if (segments.length === 2 && segments[1] === "update" && method === "POST") {
      const body = await readJsonBody(req);
      const result = await updateInstalledPlugin(segments[0], { projectRoot: parseProjectRoot(body.projectRoot), force: body.force === true });
      sendJson(res, result);
      return true;
    }

    if (segments.length === 3 && segments[1] === "studio-extension" && segments[2] === "instances" && method === "GET") {
      const projectRoot = parseProjectRoot(params.get("projectRoot"));
      if (!projectRoot) {
        sendJson(res, { error: "projectRoot is required" }, 400);
        return true;
      }
      const manifest = (await loadPluginRegistry()).get(segments[0]);
      if (!manifest?.studioExtension) {
        sendJson(res, { error: "This plugin has no Studio extension" }, 404);
        return true;
      }
      sendJson(res, { extension: manifest.studioExtension, instances: await listStudioExtensionInstances(manifest.studioExtension, projectRoot) });
      return true;
    }

    if (segments.length === 5 && segments[1] === "studio-extension" && segments[2] === "instances" && segments[4] === "files" && method === "GET") {
      const projectRoot = parseProjectRoot(params.get("projectRoot"));
      if (!projectRoot) {
        sendJson(res, { error: "projectRoot is required" }, 400);
        return true;
      }
      const manifest = (await loadPluginRegistry()).get(segments[0]);
      if (!manifest?.studioExtension) {
        sendJson(res, { error: "This plugin has no Studio extension" }, 404);
        return true;
      }
      const instance = await findStudioExtensionInstance(manifest.studioExtension, projectRoot, segments[3]);
      if (!instance) {
        sendJson(res, { error: "Instance not found" }, 404);
        return true;
      }
      sendJson(res, { instance, files: await listStudioExtensionFiles(manifest.studioExtension, instance.path) });
      return true;
    }

    if (segments.length === 5 && segments[1] === "studio-extension" && segments[2] === "instances" && segments[4] === "file" && method === "GET") {
      const projectRoot = parseProjectRoot(params.get("projectRoot"));
      const relativePath = params.get("path") ?? "";
      if (!projectRoot || !relativePath) {
        sendJson(res, { error: "projectRoot and path are required" }, 400);
        return true;
      }
      const manifest = (await loadPluginRegistry()).get(segments[0]);
      if (!manifest?.studioExtension) {
        sendJson(res, { error: "This plugin has no Studio extension" }, 404);
        return true;
      }
      const instance = await findStudioExtensionInstance(manifest.studioExtension, projectRoot, segments[3]);
      if (!instance) {
        sendJson(res, { error: "Instance not found" }, 404);
        return true;
      }
      const file = await readStudioExtensionFile(instance.path, relativePath);
      if (!file) {
        sendJson(res, { error: "File not found" }, 404);
        return true;
      }
      const extension = file.path.split(".").pop()?.toLowerCase() ?? "";
      res.writeHead(200, { "content-type": FILE_CONTENT_TYPES[extension] ?? "text/plain; charset=utf-8" });
      res.end(file.content);
      return true;
    }

    sendJson(res, { error: "Not found" }, 404);
    return true;
  } catch (error) {
    const status = error instanceof PluginCycleError || error instanceof PluginNotFoundError ? 400 : 500;
    sendJson(res, { error: error instanceof Error ? error.message : String(error) }, status);
    return true;
  }
}
