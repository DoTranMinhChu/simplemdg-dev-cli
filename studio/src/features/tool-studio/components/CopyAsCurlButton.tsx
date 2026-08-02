import { useState } from "react";
import { Button } from "../../../components/common/Button";

export type TCurlRequestSpec = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /**
   * The real Authorization header value is never sent to the browser — every call here is
   * proxied server-side specifically so the actual OAuth token/client secret never has to leave
   * the backend process (see check-api-service.ts/cpi-queue-service.ts). Pass a human-readable
   * placeholder instead (e.g. "Bearer <fetched automatically by SimpleMDG Studio>") so the copied
   * command is still runnable-looking and honest about what's missing, without ever risking a
   * real credential landing in someone's clipboard/shell history.
   */
  authorizationPlaceholder?: string;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildCurlCommand(spec: TCurlRequestSpec): string {
  const lines = [`curl -X ${spec.method} ${shellQuote(spec.url)}`];

  for (const [key, value] of Object.entries(spec.headers ?? {})) {
    lines.push(`  -H ${shellQuote(`${key}: ${value}`)}`);
  }

  if (spec.authorizationPlaceholder) {
    lines.push(`  -H ${shellQuote(`Authorization: ${spec.authorizationPlaceholder}`)}`);
  }

  if (spec.body !== undefined) {
    lines.push(`  -d ${shellQuote(JSON.stringify(spec.body))}`);
  }

  return lines.join(" \\\n");
}

export function buildFetchSnippet(spec: TCurlRequestSpec): string {
  const headers: Record<string, string> = { ...spec.headers };

  if (spec.authorizationPlaceholder) {
    headers.Authorization = spec.authorizationPlaceholder;
  }

  const init: Record<string, unknown> = { method: spec.method, headers };

  if (spec.body !== undefined) {
    init.body = JSON.stringify(spec.body);
  }

  return `fetch(${JSON.stringify(spec.url)}, ${JSON.stringify(init, null, 2)});`;
}

/** Drop-in pair of "Copy as curl" / "Copy as fetch" buttons for the last request a panel actually sent. */
export function CopyAsCurlButton({ spec }: { spec: TCurlRequestSpec }): React.ReactElement {
  const [copiedAs, setCopiedAs] = useState<"curl" | "fetch" | null>(null);

  async function copy(kind: "curl" | "fetch"): Promise<void> {
    const text = kind === "curl" ? buildCurlCommand(spec) : buildFetchSnippet(spec);
    await navigator.clipboard.writeText(text);
    setCopiedAs(kind);
    setTimeout(() => setCopiedAs(null), 1500);
  }

  return (
    <div className="row" style={{ gap: 6 }}>
      <Button variant="ghost" size="sm" onClick={() => void copy("curl")}>
        {copiedAs === "curl" ? "Copied!" : "⧉ Copy as curl"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => void copy("fetch")}>
        {copiedAs === "fetch" ? "Copied!" : "⧉ Copy as fetch"}
      </Button>
    </div>
  );
}
