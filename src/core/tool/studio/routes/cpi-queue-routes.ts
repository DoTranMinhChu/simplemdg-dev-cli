import http from "node:http";
import AdmZip from "adm-zip";
import { readRawBody, sendJson } from "../../../studio-shared/studio-server-kit";
import { createPredefinedQueues, parseEventMeshServiceKey } from "../../../deploy/cpi-queue-service";
import type { TQueueCreationResult } from "../../../deploy/cpi-queue-service";

export type TCpiQueueFileResult = {
  serviceKeyFileName: string;
  namespace?: string;
  ok: boolean;
  error?: string;
  queues?: TQueueCreationResult[];
};

export async function handleCpiQueueApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string): Promise<boolean> {
  if (url.pathname === "/api/tool/cpi-queue/upload-and-create" && method === "POST") {
    const fileName = req.headers["x-file-name"];
    if (typeof fileName !== "string" || !fileName) {
      sendJson(res, { error: "X-File-Name header is required" }, 400);
      return true;
    }

    let zipBuffer: Buffer;
    try {
      zipBuffer = await readRawBody(req, 50 * 1024 * 1024);
    } catch (error) {
      sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 413);
      return true;
    }

    let entries: AdmZip.IZipEntry[];
    try {
      entries = new AdmZip(zipBuffer).getEntries();
    } catch (error) {
      sendJson(res, { error: `Could not read '${fileName}' as a zip archive: ${error instanceof Error ? error.message : String(error)}` }, 400);
      return true;
    }

    const jsonEntries = entries.filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith(".json"));
    if (!jsonEntries.length) {
      sendJson(res, { error: "No .json service-key files were found inside the uploaded zip." }, 400);
      return true;
    }

    const results: TCpiQueueFileResult[] = [];
    for (const entry of jsonEntries) {
      const rawJson = entry.getData().toString("utf8");
      const credential = parseEventMeshServiceKey(entry.entryName, rawJson);
      if (!credential) {
        results.push({ serviceKeyFileName: entry.entryName, ok: false, error: "Not a recognizable Event Mesh service-key JSON (missing namespace/management/oa2 credentials)." });
        continue;
      }
      try {
        const queues = await createPredefinedQueues(credential);
        results.push({ serviceKeyFileName: entry.entryName, namespace: credential.namespace, ok: queues.every((queue) => queue.ok), queues });
      } catch (error) {
        results.push({ serviceKeyFileName: entry.entryName, namespace: credential.namespace, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    sendJson(res, { results });
    return true;
  }

  return false;
}
