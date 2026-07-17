import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { findRunningPortOwner, listBoundPorts } from "../../proxy-port-registry";
import { stopProxyEnvironment } from "../../proxy-runtime";
import { stopQuickProxy } from "../../proxy-quick";

export async function handlePortsApi(req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<boolean> {
  const pathname = url.pathname;

  if (pathname === "/api/proxy/ports" && method === "GET") {
    sendJson(res, { ports: listBoundPorts() });
    return true;
  }

  if (pathname === "/api/proxy/ports/kill" && method === "POST") {
    const body = await readJsonBody(req);
    const port = Number(body.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      sendJson(res, { error: "Invalid port." }, 400);
      return true;
    }

    const owner = findRunningPortOwner(port);
    if (!owner) {
      sendJson(res, { error: `Port ${port} is not currently running.` }, 404);
      return true;
    }

    if (owner.type === "quick-proxy") {
      await stopQuickProxy(owner.ownerId);
    } else {
      await stopProxyEnvironment(owner.ownerId, port);
    }

    sendJson(res, { message: `Port ${port} stopped.`, ownerId: owner.ownerId });
    return true;
  }

  return false;
}
