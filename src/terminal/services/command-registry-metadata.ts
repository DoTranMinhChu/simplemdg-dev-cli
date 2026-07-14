/**
 * Hand-authored overlay merged onto command facts derived from the live
 * Commander tree (name/description/aliases stay single-sourced from
 * Commander — this file only adds what Commander has no concept of).
 * Keyed by dot-joined command path, e.g. "git.move-code".
 */
export type TCommandMetadataOverlay = {
  category: string;
  icon?: string;
  keywords: string[];
  /**
   * "native": has a bespoke Ink screen wired to InkInteractionService — runs
   * in-process, inside the persistent shell, no legacy prompt library
   * involved. Every other command defaults to "direct-only": the palette
   * shows it (discoverable) but selecting it shows an explicit notice instead
   * of silently executing it in-shell — there is no automatic legacy-prompt
   * handoff anymore. See USER_GUIDE.md's interactive-shell section.
   */
  interactiveCapability?: "native";
};

export const CATEGORY_LABELS: Record<string, string> = {
  cf: "Cloud Foundry",
  cds: "SAP CAP",
  gitlab: "GitLab",
  git: "Git",
  npmrc: "NPM Registry",
  ai: "AI Sessions",
};

/**
 * One-line "what's in here" blurb per top-level command group, shown in the
 * shell's home screen legend (`/cf`, `/ai`, ...). Keyed by the group's
 * Commander path segment, e.g. "cf" for `smdg cf ...`. Deliberately
 * hand-authored and short (unlike leaf descriptions, which come straight from
 * Commander) — a group's own Commander `.description()` is written for
 * `--help` output and tends to run long for a single legend line.
 */
export const CATEGORY_TAGLINES: Record<string, string> = {
  cf: "Targets, apps, logs & DB Studio",
  cds: "CAP dev server, profiles & services",
  git: "Move code, cherry-pick & resolve conflicts",
  gitlab: "Login, clone & sync repositories",
  npmrc: "Registry auth & scoped tokens",
  ai: "Resume, inspect & export AI sessions",
  cache: "Inspect & clear the smart cache",
};

export const COMMAND_METADATA: Record<string, TCommandMetadataOverlay> = {
  "git.move-code": {
    category: "Git",
    icon: "⇄",
    keywords: ["move code", "release", "cherry-pick", "uat", "qas", "staging", "promote"],
    interactiveCapability: "native",
  },
  "git.pick": { category: "Git", keywords: ["cherry-pick", "pick commits"] },
  "git.trace": { category: "Git", keywords: ["build", "dependency trace", "missing module"] },
  "git.conflict": { category: "Git", keywords: ["resolve conflict", "cherry-pick conflict"] },
  "git.summary": { category: "Git", keywords: ["diff", "push", "release summary"] },
  "cf.org": {
    category: "Cloud Foundry",
    icon: "☁",
    keywords: ["switch target", "cf target", "favorites", "regions", "org", "space"],
    interactiveCapability: "native",
  },
  "cf.db.studio": {
    category: "Cloud Foundry",
    icon: "▤",
    keywords: ["open db", "database studio", "hana", "postgres", "sql"],
  },
  "cf.apps": { category: "Cloud Foundry", keywords: ["list apps", "applications"] },
  "cf.logs": { category: "Cloud Foundry", keywords: ["tail logs", "log viewer"] },
  "ai.resume": {
    category: "AI Sessions",
    icon: "▶",
    keywords: ["resume claude", "resume session", "continue session"],
  },
  "ai.studio": { category: "AI Sessions", keywords: ["ai studio", "session advisor"] },
  "ai.sessions": { category: "AI Sessions", keywords: ["list sessions"] },
  "cds.watch": { category: "SAP CAP", keywords: ["watch", "run cap", "serve"] },
  "gitlab.sync": { category: "GitLab", keywords: ["clone", "pull repos"] },
  "npmrc.create": { category: "NPM Registry", keywords: ["npmrc", "registry token"] },
};
