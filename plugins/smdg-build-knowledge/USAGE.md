# Whole-Project Knowledge Builder (`smdg-build-knowledge`)

Builds deep, code-verified knowledge documents for **every distinct business flow across the whole project** — not one flow at a time. For each flow: full entity/data model, complete status vocabulary, phase-by-phase narrative written as explicit if/else decision trees, a full Event Ledger (every topic's emit site + exact payload + consume site + exact DB effect), retry/failure semantics, a background/scheduled-job catalog, Mermaid state and sequence diagrams, and an ordered diagnostic guide — all written in **plain, simple English**, with jargon and project-specific terms explained inline or via a shared glossary.

Modeled on the manual process that produced this project's own deep Request-flow document, generalized to run across the whole project instead of one named flow.

## Usage

`/smdg-build-knowledge` — runs a full-project discovery pass and proposes a plan before doing anything expensive.

`/smdg-build-knowledge <flow name(s)>` — limits this run to specific flows (useful for a targeted follow-up after an initial full run, or to refresh just one flow).

## What it does

1. **Discovers flows itself** — it does not require you to name one. It reads any existing `.claude/knowledge/repo-map.md`/`event-map.md`/`flows.md`, looks for the project's cross-cutting core flows (a central case/workflow entity, distinctly-named process/config/background folders, anything already listed in an existing architecture doc), and enumerates per-domain flows (every business-object folder is its own flow candidate).
2. **Always proposes the full plan before running anything expensive** — the candidate flow list, which already have documented sections, a rough cost estimate, and asks: does the list look right, and for flows that already have a section, update it in place or add a new version alongside it (a global default, overridable per flow)?
3. Runs the same deep multi-agent tracing pipeline for **every** confirmed flow at the **same full depth** — cross-cutting and per-domain flows get identical treatment (fanning out `smdg-flow-tracer`, then synthesizing the results itself); there is no lighter/summarized tier for either group.
4. Maintains `.claude/knowledge/glossary.md` — an append-only shared glossary of project-specific terms, grown as new terms are encountered, so every document can explain jargon without repeating the same paragraph everywhere.
5. Writes every flow as its own section inside one consolidated file, `.claude/knowledge/flows.md` — a fresh flow gets a new `##` section, an update replaces that section's contents in place, and "keep the old version" appends a new dated section alongside the original rather than overwriting it. Nothing is ever written as a separate per-flow file.
6. Reports a final summary: every flow processed, its section heading in `flows.md`, and every known gap pulled inline.

## When to use this vs. the lighter plugins

- **`smdg-feature-cartographer`**: a quick "what does this touch" lookup for one specific feature — a handful of facts, one paragraph.
- **`smdg-knowledge-bootstrap`**: comparing a customer clone against core — a different axis (breadth across customers), not flow depth.
- **`smdg-build-knowledge`**: building or refreshing the project's knowledge base broadly, across every flow, in one deliberate (and meaningfully expensive) run.

## Knowledge output

- `.claude/knowledge/flows.md` — a single consolidated file; every flow is its own `##` section (with any kept-alongside versions as their own dated sections), indexed by a `## Contents` list at the top. Deliberately one file, not a directory tree, so the whole knowledge base stays easy to read, grep, and carry around outside any particular tool.
- `.claude/knowledge/glossary.md` — shared, append-only term glossary referenced by every flow section.

## AI Studio

This plugin does not integrate with AI Studio — its output is a plain single Markdown file, read directly (in an editor, in a terminal, or pasted elsewhere) rather than browsed through a generated-artifact viewer. Generating or refreshing `flows.md` happens from a normal Claude Code terminal session (`/smdg-build-knowledge`).

## Dependencies installed alongside this skill

- `smdg-flow-tracer` (the reusable deep-read subagent, pulled in automatically via `dependsOn`)
