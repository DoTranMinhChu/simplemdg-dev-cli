# Feature Cartographer (`smdg-feature-cartographer`)

A subagent that traces one named feature end-to-end — UI entry point → API handler → database entity/table → emitted event — and writes it up as a durable Feature Card: `.claude/knowledge/features/<feature-slug>.md`.

You normally don't invoke this agent directly — it's the feature-tracing step of the `smdg-knowledge-bootstrap` pipeline, run when you want a specific feature documented (not every time you touch a repo). It's also the piece that answers "what does this feature do and which DB does it touch" without re-reading the whole flow from scratch.

Depends on: nothing hard — it can optionally call GitNexus (`mcp__gitnexus__context`/`explain`/`trace`) as a shortcut for the UI→API hop, but only when the target repo has already been analyzed by GitNexus's Code Intelligence; it checks availability first and falls back to grep otherwise. GitNexus does **not** understand `.cds` files, so the database-entity hop is always grep/read, never a GitNexus call.

If invoked directly, give it a feature or domain name (optionally a known repo path, and a scope — core, a specific customer, or both). It:
- Checks `.claude/knowledge/repo-map.md` first for a known feature-area → repo mapping, the same way `smdg-root-cause-tracer` does, before doing any fresh directory-name routing.
- Traces UI entry point → API/handler → DB entity/table → emitted event, reading only the specific matched files at each hop.
- Cross-checks any emitted event against `.claude/knowledge/event-map.md` rather than re-tracing its consumers (that's the sweeper's job, not this agent's).
- Drafts or refreshes the Feature Card **in place** — unlike the other knowledge files, this one is a "current understanding" doc, not an append-only log, though it keeps its own append-only `## Revision history` section at the bottom.
- Flags anything sampled or unverified under a `## Needs human confirmation` section, so a reader knows what's settled vs. what still needs a second pair of eyes.

It stops and asks when no repo can be found checked out for the feature at all — otherwise it proceeds as far as the trace allows and notes any hop it couldn't complete under "Needs human confirmation" rather than stopping outright.

## Knowledge output

`.claude/knowledge/features/<feature-slug>.md` — a plain project file, not installed or managed by this plugin directly, safe to commit or `.gitignore` per your team's preference. One file per feature (glob `.claude/knowledge/features/*.md` to see what's been mapped so far).
