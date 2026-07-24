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
   * "native": has a bespoke Ink screen — either a modal-interaction workflow
   * (wired to InkInteractionService, registered in TerminalRouter.tsx's
   * NATIVE_SCREENS) or a long-running/tailing session (wired to
   * StreamingSessionService, registered in STREAMING_SCREENS) — runs
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
  plugin: "Browse, install, update & remove Claude Code plugins",
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
    interactiveCapability: "native",
  },
  "cf.apps": { category: "Cloud Foundry", keywords: ["list apps", "applications"], interactiveCapability: "native" },
  "cf.env": { category: "Cloud Foundry", keywords: ["export env", "cf env", "vcap services"], interactiveCapability: "native" },
  "cf.target": { category: "Cloud Foundry", keywords: ["current target", "cf target"], interactiveCapability: "native" },
  "cf.cache": { category: "Cloud Foundry", keywords: ["cf cache", "cached values"], interactiveCapability: "native" },
  "cf.region.list": { category: "Cloud Foundry", keywords: ["list regions", "cf regions"], interactiveCapability: "native" },
  "cf.region.add": { category: "Cloud Foundry", keywords: ["add region", "custom cf region"], interactiveCapability: "native" },
  "cf.region.test": { category: "Cloud Foundry", keywords: ["test region", "region reachability"], interactiveCapability: "native" },
  "cf.region.refresh": { category: "Cloud Foundry", keywords: ["refresh region", "cross-region targets"], interactiveCapability: "native" },
  "cf.db.connections": { category: "Cloud Foundry", keywords: ["db connections", "manage connections"], interactiveCapability: "native" },
  "cf.logs": {
    category: "Cloud Foundry",
    keywords: ["tail logs", "log viewer", "follow logs", "realtime logs"],
    interactiveCapability: "native",
  },
  "cf.http-watch": {
    category: "Cloud Foundry",
    keywords: ["watch http", "http traffic", "request watch"],
    interactiveCapability: "native",
  },
  "proxy.start": {
    category: "Proxy",
    keywords: ["start proxy", "run proxy", "proxy environment"],
    interactiveCapability: "native",
  },
  "proxy.login": { category: "Proxy", keywords: ["proxy login", "logged in browser"], interactiveCapability: "native" },
  "proxy.stop": { category: "Proxy", keywords: ["stop proxy"], interactiveCapability: "native" },
  "proxy.status": { category: "Proxy", keywords: ["proxy status"], interactiveCapability: "native" },
  "proxy.list": { category: "Proxy", keywords: ["list proxy environments"], interactiveCapability: "native" },
  "proxy.export": { category: "Proxy", keywords: ["export proxy config", "backup"], interactiveCapability: "native" },
  "proxy.import": { category: "Proxy", keywords: ["import proxy config", "restore"], interactiveCapability: "native" },
  "ai.resume": {
    category: "AI Sessions",
    icon: "▶",
    keywords: ["resume claude", "resume session", "continue session"],
  },
  "ai.studio": { category: "AI Sessions", keywords: ["ai studio", "session advisor"], interactiveCapability: "native" },
  "tool.studio": { category: "Tools", keywords: ["tool studio", "deploy tooling"], interactiveCapability: "native" },
  "proxy.studio": { category: "Proxy", keywords: ["proxy studio", "capture proxy ui"], interactiveCapability: "native" },
  "ai.sessions": { category: "AI Sessions", keywords: ["list sessions"], interactiveCapability: "native" },
  "ai.doctor": { category: "AI Sessions", keywords: ["ai doctor", "ingestion status"], interactiveCapability: "native" },
  "ai.scan": { category: "AI Sessions", keywords: ["refresh sessions", "re-scan"], interactiveCapability: "native" },
  "ai.inspect": { category: "AI Sessions", keywords: ["inspect session", "session detail"], interactiveCapability: "native" },
  "ai.export": { category: "AI Sessions", keywords: ["export session"], interactiveCapability: "native" },
  "ai.open": { category: "AI Sessions", keywords: ["open project folder"], interactiveCapability: "native" },
  "ai.copy-command": { category: "AI Sessions", keywords: ["copy resume command"], interactiveCapability: "native" },
  "ai.nexus.status": { category: "Code Intelligence", keywords: ["gitnexus status", "readiness"], interactiveCapability: "native" },
  "ai.nexus.doctor": { category: "Code Intelligence", keywords: ["gitnexus doctor", "diagnostics"], interactiveCapability: "native" },
  "ai.nexus.overview": { category: "Code Intelligence", keywords: ["project overview", "repo stats"], interactiveCapability: "native" },
  "ai.nexus.search": { category: "Code Intelligence", keywords: ["feature search", "concept search"], interactiveCapability: "native" },
  "ai.nexus.trace": { category: "Code Intelligence", keywords: ["caller trace", "callee trace", "symbol trace"], interactiveCapability: "native" },
  "ai.nexus.impact": { category: "Code Intelligence", keywords: ["blast radius", "change impact"], interactiveCapability: "native" },
  "cache.status": { category: "General", keywords: ["cache status", "smart cache"], interactiveCapability: "native" },
  "cache.clear": { category: "General", keywords: ["clear cache", "invalidate"], interactiveCapability: "native" },
  "cache.refresh": { category: "General", keywords: ["refresh cache", "invalidate"], interactiveCapability: "native" },
  "cds.watch": { category: "SAP CAP", keywords: ["watch", "run cap", "serve"] },
  "cds.profiles": { category: "SAP CAP", keywords: ["cap profiles"], interactiveCapability: "native" },
  "cds.services": { category: "SAP CAP", keywords: ["cap services"], interactiveCapability: "native" },
  "cds.compline": { category: "SAP CAP", keywords: ["cds compile", "export metadata"], interactiveCapability: "native" },
  "cds.edmx": { category: "SAP CAP", keywords: ["edmx", "metadata export"], interactiveCapability: "native" },
  "gitlab.sync": { category: "GitLab", keywords: ["clone", "pull repos"] },
  "gitlab.auth-status": { category: "GitLab", keywords: ["whoami", "gitlab login status"], interactiveCapability: "native" },
  "gitlab.logout": { category: "GitLab", keywords: ["gitlab logout", "clear gitlab auth"], interactiveCapability: "native" },
  "gitlab.groups": { category: "GitLab", keywords: ["list groups", "gitlab groups"], interactiveCapability: "native" },
  "gitlab.projects": { category: "GitLab", keywords: ["list projects", "gitlab projects"], interactiveCapability: "native" },
  "npmrc.create": { category: "NPM Registry", keywords: ["npmrc", "registry token"] },
  "npmrc.list": { category: "NPM Registry", keywords: ["npmrc cache", "list tokens"], interactiveCapability: "native" },
  "plugin.list": { category: "Tools", keywords: ["list plugins", "available plugins"], interactiveCapability: "native" },
  "plugin.info": { category: "Tools", keywords: ["plugin details", "plugin usage"], interactiveCapability: "native" },
  "plugin.doctor": { category: "Tools", keywords: ["plugin drift", "plugin diagnostics"], interactiveCapability: "native" },
  "plugin.add": { category: "Tools", keywords: ["install plugin"], interactiveCapability: "native" },
  "plugin.remove": { category: "Tools", keywords: ["uninstall plugin"], interactiveCapability: "native" },
  "plugin.update": { category: "Tools", keywords: ["update plugin", "re-sync plugin"], interactiveCapability: "native" },
};
