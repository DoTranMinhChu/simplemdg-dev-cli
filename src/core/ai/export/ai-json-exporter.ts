import type { IAiSessionExporter, TAiSessionExport } from "./ai-export-types";

export const jsonExporter: IAiSessionExporter = {
  format: "json",
  export(bundle, context) {
    const { include } = context;
    const envelope: TAiSessionExport = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      session: bundle.session,
      turns: bundle.turns,
      redaction: context.redaction,
    };

    if (include.conversation || include.toolCalls || include.toolOutputs || include.reasoning) {
      envelope.observations = include.rawMetadata ? bundle.observations : bundle.observations.map((observation) => ({ ...observation, metadata: "" }));
    }
    if (include.errors || include.verification || include.files) envelope.analysis = bundle.analysis;
    if (include.files) envelope.files = bundle.analysis.fileImpact;
    if (include.errors) envelope.errors = bundle.analysis.errorGroups;
    if (include.verification) envelope.verification = bundle.analysis.verification;

    return { content: JSON.stringify(envelope, null, 2), mimeType: "application/json", extension: "json" };
  },
};
