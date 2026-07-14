import type { TAiObservation, TAiSession, TAiTurn, TErrorGroup, TFileImpact, TSessionAnalysis, TVerificationCheck } from "../ai-types";

/** "pdf" is intentionally not a backend format — Export PDF fetches the html export and opens it
 *  for the browser's own print-to-PDF, so the server only ever produces these four. */
export type TAiExportFormat = "markdown" | "html" | "json" | "zip";

export type TAiExportPreset = "conversation" | "learning" | "engineering" | "full" | "custom";

export type TAiExportInclude = {
  conversation: boolean;
  toolCalls: boolean;
  toolOutputs: boolean;
  reasoning: boolean;
  files: boolean;
  commands: boolean;
  errors: boolean;
  verification: boolean;
  rawMetadata: boolean;
};

export type TAiSessionExportInput = {
  sessionId: string;
  format: TAiExportFormat;
  preset: TAiExportPreset;
  /** Only consulted when preset === "custom"; otherwise the preset table below wins. */
  include?: Partial<TAiExportInclude>;
  redactSecrets: boolean;
  includeLocalPaths: boolean;
  theme: "light" | "dark";
};

export type TAiExportBundle = {
  session: TAiSession;
  turns: TAiTurn[];
  observations: TAiObservation[];
  analysis: TSessionAnalysis;
};

export type TAiSessionExportResult = {
  content: string | Buffer;
  mimeType: string;
  extension: string;
};

export type TAiExportContext = {
  include: TAiExportInclude;
  theme: "light" | "dark";
  /** Computed once by the export service from the pre-redaction bundle — how many fields the JSON
   *  exporter should report in its `redaction.redactedFieldCount` envelope field. */
  redaction: { enabled: boolean; redactedFieldCount: number };
};

export interface IAiSessionExporter {
  readonly format: TAiExportFormat;
  export(bundle: TAiExportBundle, context: TAiExportContext): Promise<TAiSessionExportResult> | TAiSessionExportResult;
}

/** Versioned JSON export envelope — §26 of the spec. */
export type TAiSessionExport = {
  version: string;
  exportedAt: string;
  session: TAiSession;
  turns: TAiTurn[];
  observations?: TAiObservation[];
  analysis?: TSessionAnalysis;
  files?: TFileImpact[];
  errors?: TErrorGroup[];
  verification?: TVerificationCheck[];
  redaction: { enabled: boolean; redactedFieldCount: number };
};

export type TAiExportPreview = {
  format: TAiExportFormat;
  preset: TAiExportPreset;
  include: TAiExportInclude;
  sections: { included: string[]; excluded: string[] };
  redactedFieldCount: number;
  estimatedBytes: number;
};

const PRESET_TABLE: Record<Exclude<TAiExportPreset, "custom">, TAiExportInclude> = {
  conversation: {
    conversation: true,
    toolCalls: false,
    toolOutputs: false,
    reasoning: false,
    files: false,
    commands: false,
    errors: false,
    verification: false,
    rawMetadata: false,
  },
  learning: {
    conversation: true,
    toolCalls: true,
    toolOutputs: false,
    reasoning: false,
    files: false,
    commands: false,
    errors: false,
    verification: true,
    rawMetadata: false,
  },
  engineering: {
    conversation: true,
    toolCalls: true,
    toolOutputs: true,
    reasoning: false,
    files: true,
    commands: true,
    errors: true,
    verification: true,
    rawMetadata: false,
  },
  full: {
    conversation: true,
    toolCalls: true,
    toolOutputs: true,
    reasoning: true,
    files: true,
    commands: true,
    errors: true,
    verification: true,
    rawMetadata: true,
  },
};

const ALL_EXCLUDED: TAiExportInclude = {
  conversation: false,
  toolCalls: false,
  toolOutputs: false,
  reasoning: false,
  files: false,
  commands: false,
  errors: false,
  verification: false,
  rawMetadata: false,
};

/** §28 — resolves a preset (or a custom include set) into the concrete flags every exporter reads. */
export function resolveInclude(preset: TAiExportPreset, custom?: Partial<TAiExportInclude>): TAiExportInclude {
  if (preset === "custom") return { ...ALL_EXCLUDED, ...custom };
  return PRESET_TABLE[preset];
}

export const INCLUDE_SECTION_LABELS: Record<keyof TAiExportInclude, string> = {
  conversation: "Conversation (user + assistant messages)",
  toolCalls: "Tool call summaries",
  toolOutputs: "Full tool input/output",
  reasoning: "Internal reasoning",
  files: "Files changed",
  commands: "Shell commands",
  errors: "Errors",
  verification: "Verification checks",
  rawMetadata: "Raw observation metadata",
};
