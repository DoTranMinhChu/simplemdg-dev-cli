import type http from "node:http";

export type TJsonBody = Record<string, unknown>;

export function sendJson(res: http.ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

export async function readJsonBody(req: http.IncomingMessage): Promise<TJsonBody> {
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
