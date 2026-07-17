import { createRequire } from "node:module";
import { getDirname } from "../esm-paths";

/**
 * Wraps the legacy tool's exact CDS formatter (`@sap/cds-lsp`'s internal `CdsPrettyPrint.beautify`)
 * so the DB-model generator's output is byte-for-byte the same style already committed in every
 * customer repo — confirmed against a real MR diff: without this, every line of a regenerated file
 * reads as "changed" purely from a different (readable, but non-matching) indentation/alignment
 * convention, making diffs unreviewable even when the underlying content is identical.
 *
 * Two things make this fragile enough to isolate in its own module:
 * 1. `@sap/cds-lsp` is SAP-internal and undocumented — its exports are NOT stable across versions
 *    (confirmed: the latest npm release, 10.0.1, no longer exposes `CdsPrettyPrint` the way this
 *    code expects). Pinned to the exact version the legacy tool used, `5.5.7`, which does.
 * 2. Importing it via ESM `import * as X` silently loses the named CJS exports in this project's
 *    module setup (`Object.keys` only shows `__esModule`/`default`/`module.exports`) — confirmed
 *    that `createRequire` (genuine CJS `require`) is what actually surfaces `CdsPrettyPrint`.
 *
 * `beautify()` also requires a logger with every method the SAP LSP internals might call
 * (`.verbose`, etc., not just the usual `.info`/`.warn`/`.error`) — a `Proxy` that returns a no-op
 * function for any property access sidesteps needing to know the full interface.
 */

type TCdsPrettyPrintModule = {
  CdsPrettyPrint: new (
    logger: unknown,
    metaModel?: unknown,
  ) => {
    getDefaultOptions: () => { metaModel: unknown };
    beautify: (content: string, options: { tabSize: number; insertFinalNewline: boolean }, workspaceRoot: string, documentRoot: string) => { formattedContent: string };
  };
};

const NOOP_LOGGER = new Proxy(
  {},
  {
    get: () => () => undefined,
  },
);

let cachedModule: TCdsPrettyPrintModule | undefined;

function loadCdsPrettyPrintModule(): TCdsPrettyPrintModule {
  if (!cachedModule) {
    const require = createRequire(import.meta.url);
    cachedModule = require("@sap/cds-lsp/dist") as TCdsPrettyPrintModule;
  }
  return cachedModule;
}

/** Brace-depth indenter (4 spaces/level) used only if the real formatter fails to load or throws — a formatting hiccup must never block a deploy. Not stylistically matched to legacy, just readable. */
function formatCdsTextFallback(lines: string[]): string {
  const output: string[] = [];
  let depth = 0;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      output.push("");
      continue;
    }
    if (line.startsWith("}")) depth = Math.max(0, depth - 1);
    const isRelationContinuation = /^(on|and)\s/.test(line);
    output.push("    ".repeat(depth + (isRelationContinuation ? 1 : 0)) + line);
    if (line.endsWith("{")) depth += 1;
  }
  return output.join("\n");
}

export function formatCdsText(lines: string[]): string {
  const source = lines.join("\n");
  try {
    const cdsPrettyPrint = loadCdsPrettyPrintModule();
    const dirname = getDirname(import.meta.url);
    const defaultOptionsHolder = new cdsPrettyPrint.CdsPrettyPrint(NOOP_LOGGER);
    const metaModel = defaultOptionsHolder.getDefaultOptions().metaModel;
    const prettier = new cdsPrettyPrint.CdsPrettyPrint(NOOP_LOGGER, metaModel);
    const result = prettier.beautify(source, { tabSize: 4, insertFinalNewline: true }, dirname, dirname);
    return result.formattedContent;
  } catch {
    return formatCdsTextFallback(lines);
  }
}
