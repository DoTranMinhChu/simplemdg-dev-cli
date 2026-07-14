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
};

export const CATEGORY_LABELS: Record<string, string> = {
  cf: "Cloud Foundry",
  cds: "SAP CAP",
  gitlab: "GitLab",
  git: "Git",
  npmrc: "NPM Registry",
  ai: "AI Sessions",
};

export const COMMAND_METADATA: Record<string, TCommandMetadataOverlay> = {
  "git.move-code": {
    category: "Git",
    icon: "⇄",
    keywords: ["move code", "release", "cherry-pick", "uat", "qas", "staging", "promote"],
  },
  "git.pick": { category: "Git", keywords: ["cherry-pick", "pick commits"] },
  "git.trace": { category: "Git", keywords: ["build", "dependency trace", "missing module"] },
  "git.conflict": { category: "Git", keywords: ["resolve conflict", "cherry-pick conflict"] },
  "git.summary": { category: "Git", keywords: ["diff", "push", "release summary"] },
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
