import { containsLikelySecret, redactSecrets } from "../ai-secret-redaction";
import type { TAiExportBundle } from "./ai-export-types";

/** Counts fields across the bundle that contain a likely secret — the export preview's "N values
 *  will be redacted", computed with the exact same rules `redactSecrets` uses to mask them. */
export function countRedactions(bundle: TAiExportBundle): number {
  let count = 0;
  const check = (text: string): void => {
    if (text && containsLikelySecret(text)) count += 1;
  };

  for (const observation of bundle.observations) {
    check(observation.input);
    check(observation.output);
  }
  for (const turn of bundle.turns) check(turn.userRequest);
  for (const group of bundle.analysis.errorGroups) check(group.message);

  return count;
}

/** §31 — masks the session's own absolute working directory out of exported text/paths by default. */
export function maskLocalPaths(text: string, cwd: string): string {
  if (!text || !cwd) return text;
  const escaped = cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(escaped, "g"), "<project>").replace(new RegExp(escaped.replace(/\\\\/g, "/"), "g"), "<project>");
}

export type TRedactionOptions = { redactSecrets: boolean; includeLocalPaths: boolean };

/** Applies secret redaction and local-path masking across the whole bundle before any exporter sees it. */
export function redactBundle(bundle: TAiExportBundle, options: TRedactionOptions): TAiExportBundle {
  const transform = (text: string): string => {
    let result = text;
    if (options.redactSecrets) result = redactSecrets(result);
    if (!options.includeLocalPaths) result = maskLocalPaths(result, bundle.session.cwd);
    return result;
  };

  return {
    session: {
      ...bundle.session,
      cwd: options.includeLocalPaths ? bundle.session.cwd : "<project>",
      sourceFile: options.includeLocalPaths ? bundle.session.sourceFile : "<redacted>",
    },
    turns: bundle.turns.map((turn) => ({ ...turn, userRequest: transform(turn.userRequest) })),
    observations: bundle.observations.map((observation) => ({ ...observation, input: transform(observation.input), output: transform(observation.output) })),
    analysis: {
      ...bundle.analysis,
      errorGroups: bundle.analysis.errorGroups.map((group) => ({ ...group, message: transform(group.message) })),
      fileImpact: bundle.analysis.fileImpact.map((file) => ({ ...file, path: transform(file.path) })),
      commandsRun: bundle.analysis.commandsRun.map((command) => transform(command)),
    },
  };
}
