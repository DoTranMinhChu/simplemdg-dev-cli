import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { htmlExporter } from "./ai-html-exporter";
import { jsonExporter } from "./ai-json-exporter";
import { markdownExporter } from "./ai-markdown-exporter";
import type { IAiSessionExporter, TAiExportBundle, TAiExportContext } from "./ai-export-types";

function buildReadme(bundle: TAiExportBundle, context: TAiExportContext): string {
  const included = Object.entries(context.include)
    .filter(([, on]) => on)
    .map(([key]) => key);
  return [
    "AI Studio session export",
    "",
    `Session:  ${bundle.session.title}`,
    `Provider: ${bundle.session.provider}`,
    `Project:  ${bundle.session.project}`,
    `Exported: ${new Date().toISOString()}`,
    `Sections included: ${included.join(", ") || "(none)"}`,
    `Secrets redacted: ${context.redaction.enabled ? "yes" : "no"} (${context.redaction.redactedFieldCount} value${context.redaction.redactedFieldCount === 1 ? "" : "s"})`,
    "",
    "Contents:",
    "  session.html          - standalone, offline-readable export (open in any browser)",
    "  session.md            - Markdown version",
    "  session.json          - structured JSON export",
    context.include.files ? "  files-changed.csv     - file read/edit counts" : "",
    context.include.commands ? "  commands.txt          - shell commands run" : "",
    context.include.verification ? "  verification.md       - verification checks" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function filesChangedCsv(bundle: TAiExportBundle): string {
  const header = "path,reads,edits,firstTurn,lastTurn";
  const rows = bundle.analysis.fileImpact.map((file) => `"${file.path.replace(/"/g, '""')}",${file.reads},${file.edits},${file.firstTurnIndex},${file.lastTurnIndex}`);
  return [header, ...rows].join("\n");
}

function verificationMd(bundle: TAiExportBundle): string {
  const lines = ["# Verification", ""];
  for (const check of bundle.analysis.verification) lines.push(`- ${check.status.toUpperCase()} ${check.label}`);
  return lines.join("\n");
}

/** Bundles session.html + session.md + session.json + README.txt (+ optional CSV/txt/md sidecars)
 *  into an in-memory ZIP buffer — export sizes here are text-scale, so buffering is fine. */
export const zipExporter: IAiSessionExporter = {
  format: "zip",
  async export(bundle, context) {
    const archive = new ZipArchive({ zlib: { level: 9 } });
    const chunks: Buffer[] = [];
    const collector = new PassThrough();
    collector.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.pipe(collector);

    const done = new Promise<Buffer>((resolve, reject) => {
      collector.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
    });

    const [html, markdown, json] = await Promise.all([htmlExporter.export(bundle, context), markdownExporter.export(bundle, context), jsonExporter.export(bundle, context)]);
    archive.append(String(html.content), { name: "session.html" });
    archive.append(String(markdown.content), { name: "session.md" });
    archive.append(String(json.content), { name: "session.json" });
    archive.append(buildReadme(bundle, context), { name: "README.txt" });
    if (context.include.files && bundle.analysis.fileImpact.length) archive.append(filesChangedCsv(bundle), { name: "files-changed.csv" });
    if (context.include.commands && bundle.analysis.commandsRun.length) archive.append(bundle.analysis.commandsRun.join("\n\n"), { name: "commands.txt" });
    if (context.include.verification && bundle.analysis.verification.length) archive.append(verificationMd(bundle), { name: "verification.md" });

    await archive.finalize();
    const buffer = await done;
    return { content: buffer, mimeType: "application/zip", extension: "zip" };
  },
};
