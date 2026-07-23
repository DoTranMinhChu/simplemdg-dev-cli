# Whole-Project Knowledge Builder (`smdg-build-knowledge`)

Builds deep, code-verified knowledge documents for **every distinct business flow across the whole project** — not one flow at a time. For each flow: full entity/data model, complete status vocabulary, phase-by-phase narrative written as explicit if/else decision trees, a full Event Ledger (every topic's emit site + exact payload + consume site + exact DB effect), retry/failure semantics, a background/scheduled-job catalog, Mermaid state and sequence diagrams, and an ordered diagnostic guide — all written in **plain, simple English**, with jargon and project-specific terms explained inline or via a shared glossary.

Modeled on the manual process that produced this project's own deep Request-flow document, generalized to run across the whole project instead of one named flow.

## Usage

`/smdg-build-knowledge` — runs a full-project discovery pass and proposes a plan before doing anything expensive.

`/smdg-build-knowledge <flow name(s)>` — limits this run to specific flows (useful for a targeted follow-up after an initial full run, or to refresh just one flow).

## What it does

1. **Discovers flows itself** — it does not require you to name one. It reads any existing `.claude/knowledge/repo-map.md`/`event-map.md`/`flows/*`, looks for the project's cross-cutting core flows (a central case/workflow entity, distinctly-named process/config/background folders, anything already listed in an existing architecture doc), and enumerates per-domain flows (each business-object folder gets at least a lighter, cross-referencing pass).
2. **Always proposes the full plan before running anything expensive** — the candidate flow list, which already have documents, a rough cost estimate, and asks: does the list look right, and for flows that already have a document, update in place or write a new version alongside it (a global default, overridable per flow)?
3. Runs the same deep multi-agent tracing pipeline per confirmed flow (fanning out `smdg-flow-tracer`, then synthesizing the results itself), scaling depth to the flow's tier — full depth for cross-cutting flows, a lighter cross-referencing pass for per-domain ones.
4. Maintains `.claude/knowledge/glossary.md` — an append-only shared glossary of project-specific terms, grown as new terms are encountered, so every document can explain jargon without repeating the same paragraph everywhere.
5. Writes each flow's document to `.claude/knowledge/flows/<flow-slug>/<flow-slug>.md` (a fresh flow), overwrites it in place (an update), or writes `<flow-slug>-v<N>.md` alongside the untouched original (a new version) — per the choice made in step 2.
6. Reports a final summary: every flow processed, its document path(s), and every known gap pulled inline.

## When to use this vs. the lighter plugins

- **`smdg-feature-cartographer`**: a quick "what does this touch" lookup for one specific feature — a handful of facts, one paragraph.
- **`smdg-knowledge-bootstrap`**: comparing a customer clone against core — a different axis (breadth across customers), not flow depth.
- **`smdg-build-knowledge`**: building or refreshing the project's knowledge base broadly, across every flow, in one deliberate (and meaningfully expensive) run.

## Knowledge output

- `.claude/knowledge/flows/<flow-slug>/<flow-slug>[-v<N>].md` — one directory per flow, one or more versions inside.
- `.claude/knowledge/glossary.md` — shared, append-only term glossary referenced by every flow document.

## AI Studio

Once installed, open `smdg ai studio` → **Plugins** → this plugin's detail page → **Open Flow Knowledge Explorer** to browse every generated flow document (and every version of each, if you chose to keep old ones) without leaving the UI — the same generic Evidence-Explorer renderer `smdg-jira-fix-issue` uses for its bug-investigation evidence, pointed at `.claude/knowledge/flows/*` instead. Generating or refreshing documents still happens from a normal Claude Code terminal session (`/smdg-build-knowledge`) — Studio browses results already on disk, it does not launch the run itself.

## Dependencies installed alongside this skill

- `smdg-flow-tracer` (the reusable deep-read subagent, pulled in automatically via `dependsOn`)
