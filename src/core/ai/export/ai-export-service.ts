import { analyzeSession, deriveTurns } from "../ai-session-analysis";
import type { AiSessionStore } from "../ai-session-store";
import { sanitizeFileName } from "./ai-export-content";
import { countRedactions, redactBundle } from "./ai-redaction-service";
import { htmlExporter } from "./ai-html-exporter";
import { jsonExporter } from "./ai-json-exporter";
import { markdownExporter } from "./ai-markdown-exporter";
import { zipExporter } from "./ai-zip-exporter";
import { INCLUDE_SECTION_LABELS, resolveInclude } from "./ai-export-types";
import type { IAiSessionExporter, TAiExportBundle, TAiExportContext, TAiExportInclude, TAiExportPreview, TAiSessionExportInput, TAiSessionExportResult } from "./ai-export-types";

const EXPORTERS: Record<TAiSessionExportInput["format"], IAiSessionExporter> = {
  markdown: markdownExporter,
  html: htmlExporter,
  json: jsonExporter,
  zip: zipExporter,
};

async function prepareExport(store: AiSessionStore, input: TAiSessionExportInput): Promise<{ bundle: TAiExportBundle; context: TAiExportContext }> {
  const session = store.getSession(input.sessionId);
  if (!session) throw new Error(`Session not found: ${input.sessionId}`);

  const observations = store.getObservations(input.sessionId);
  const turns = deriveTurns(observations);
  const analysis = analyzeSession(input.sessionId, observations);
  const originalBundle: TAiExportBundle = { session, turns, observations, analysis };

  const include = resolveInclude(input.preset, input.include);
  const redactedFieldCount = countRedactions(originalBundle);
  const bundle = redactBundle(originalBundle, { redactSecrets: input.redactSecrets, includeLocalPaths: input.includeLocalPaths });
  const context: TAiExportContext = { include, theme: input.theme, redaction: { enabled: input.redactSecrets, redactedFieldCount } };

  return { bundle, context };
}

function sectionLabels(include: TAiExportInclude, want: boolean): string[] {
  return (Object.entries(include) as Array<[keyof TAiExportInclude, boolean]>).filter(([, on]) => on === want).map(([key]) => INCLUDE_SECTION_LABELS[key]);
}

/** Runs the real export pipeline and reports what it produced, without triggering a download. */
export async function previewExport(store: AiSessionStore, input: TAiSessionExportInput): Promise<TAiExportPreview> {
  const { bundle, context } = await prepareExport(store, input);
  const result = await EXPORTERS[input.format].export(bundle, context);
  const estimatedBytes = typeof result.content === "string" ? Buffer.byteLength(result.content, "utf8") : result.content.length;

  return {
    format: input.format,
    preset: input.preset,
    include: context.include,
    sections: { included: sectionLabels(context.include, true), excluded: sectionLabels(context.include, false) },
    redactedFieldCount: context.redaction.redactedFieldCount,
    estimatedBytes,
  };
}

/** Generates the actual export file. Synchronous request/response — no export-job store, since this
 *  is a local single-user tool and exports here are text-scale (see plan for the reasoning). */
export async function runExport(store: AiSessionStore, input: TAiSessionExportInput): Promise<TAiSessionExportResult & { fileName: string }> {
  const { bundle, context } = await prepareExport(store, input);
  const result = await EXPORTERS[input.format].export(bundle, context);
  return { ...result, fileName: `${sanitizeFileName(bundle.session.title)}.${result.extension}` };
}
