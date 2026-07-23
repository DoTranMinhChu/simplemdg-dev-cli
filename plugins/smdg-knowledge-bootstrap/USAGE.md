# Customer/Core Knowledge Bootstrap (`smdg-knowledge-bootstrap`)

Deliberately-invoked (not per-bug-ticket) pipeline that builds durable, incrementally-refreshable knowledge about a core "Internal" product and its per-customer clones: what's shared vs. customized, and — optionally — how a specific feature works end-to-end (UI → API → Database → Event).

## Usage

Either:
- Type `/smdg-knowledge-bootstrap <core-path> <customer-path...>`, or
- Just ask Claude to "build/refresh knowledge for core vs. these customer projects" and mention the paths — the skill's `description` lets Claude pick it up automatically.

You'll be asked one question in plain chat before anything happens: whether you also want a specific feature traced end-to-end this run (optional — you can run this purely for the overlay comparison and skip feature tracing entirely).

## What it does

1. `smdg-overlay-diff-scout` compares the core baseline against each customer clone you gave it, domain folder by domain folder. Customer clones are treated as **separate directory trees with no shared git history** — comparison is structural (file-set diff) plus sampled content anchors, not an exact `git diff`. Every domain gets tagged `identical-to-core`, `overridden`, `customer-only`, or `core-only-not-cloned`, with an explicit `sampled`/`full-diff` confidence label — it never claims more certainty than a sample supports.
2. If you asked for a feature trace, `smdg-feature-cartographer` traces that feature's UI entry point → API handler → database entity/table → any emitted event, against core, a named customer, or both, and drafts a Feature Card.
3. You get a final summary listing every knowledge file touched, with anything either subagent flagged as needing human confirmation pulled directly into the summary — not left for you to go dig up yourself.

## Knowledge output

Everything lands under `.claude/knowledge/` in your current project — plain project files, not managed by any plugin's install/uninstall, safe to commit or `.gitignore` per your team's preference:
- `customers/<customer-slug>.md` — one file per customer, one block per domain compared (see `smdg-overlay-diff-scout`'s own USAGE.md for the exact schema)
- `features/<feature-slug>.md` — one Feature Card per traced feature, refined in place on re-runs with its own append-only revision history (see `smdg-feature-cartographer`'s own USAGE.md)

This pipeline shares its knowledge files' conventions with the bug-investigation pipeline (`smdg-jira-fix-issue`) — `.claude/knowledge/repo-map.md` and `.claude/knowledge/event-map.md` are read (not written) by the two subagents here, so a feature-area already traced by a bug investigation is nearly free to look up again during a bootstrap run, and vice versa.

## Re-running as the codebase evolves

This is meant to be re-run, not a one-time snapshot: pointing it at the same core/customer pair again refines the existing `customers/<slug>.md` entries and Feature Cards, since both subagents check what's already recorded before re-deriving it from scratch. There's no scheduling built in — re-run it manually after a meaningful upgrade, or whenever a customer overlay or feature's behavior needs re-confirming.

## Dependencies installed alongside this skill

- `smdg-overlay-diff-scout`, `smdg-feature-cartographer` (the two subagents, pulled in automatically via `dependsOn`)
