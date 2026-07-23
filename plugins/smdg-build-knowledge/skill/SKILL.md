---
name: smdg-build-knowledge
description: Deliberately invoked (never automatic) orchestrator that builds deep, code-verified knowledge documents for every distinct business flow across the whole project — not just one named flow. Discovers flows itself, checks which already have docs and asks whether to update or version them, and writes everything in plain, simple English with jargon explained. Use when the user wants the project's knowledge base built or refreshed broadly. Invoke with /smdg-build-knowledge, optionally naming specific flows to limit scope for a follow-up run.
argument-hint: [optional: specific flow name(s) to limit this run to]
---
The user wants the project's knowledge base built: $ARGUMENTS

This is a whole-project operation by default — it does not require the user to name one flow. If `$ARGUMENTS` names specific flow(s), treat that as a scope filter for *this run only* (useful for a follow-up pass after the first full run), not a requirement to always name one.

## Writing style — applies to every document this skill produces

Write in **plain, simple English** a working developer who is new to this codebase (or an AI session with no prior context) can follow without re-reading twice. Short sentences over long ones. When you must use a project-specific or domain-specific term (an internal name, an abbreviation, a status value, a SAP/CAP-specific concept), **explain it the first time it appears in a document** — either inline in parentheses or by linking to the shared glossary (see below). Never assume the reader already knows the codebase's shorthand. Never write a vague or generic sentence where a concrete one is possible — if a claim can be traced to real code, trace it; don't summarize a mechanism away as "handled elsewhere" without naming the actual file that handles it.

**Citations are file-level, not line-level.** Point to the file responsible for a claim (e.g. "see `EventStartActivate.ts`") — do not cite specific line numbers or ranges anywhere in these documents. Line numbers drift out of date as code changes; a file reference stays useful far longer. This applies throughout every section below, including inside `smdg-flow-tracer`'s own reports back to you — when you write its assignment prompt, tell it to cite files, not lines.

## 1. Maintain a shared glossary: `.claude/knowledge/glossary.md`

Before writing any flow document, read `.claude/knowledge/glossary.md` if it exists (its absence is normal — create it on first use). As you build each flow's document, whenever you need to explain a term that isn't already defined there, **add it to the glossary** (append-only — never delete or redefine an existing entry, only add missing ones) rather than re-explaining it inline in every document. Format:
```markdown
## <Term>
<One or two plain-English sentences explaining what it means in this codebase, and why it matters.>
```
Every flow document should link to this file at the top (`See .claude/knowledge/glossary.md for unfamiliar terms.`) and only inline-explain a term the *first time it's used in that specific document*, briefly, even if it's already in the glossary — a reader shouldn't have to jump files to follow along, but shouldn't get the same paragraph-long explanation five times either.

## 2. Discover every distinct flow in the project (skip this only if `$ARGUMENTS` named specific flows)

Do NOT ask the user to name flows one at a time — find them yourself:
1. Read `.claude/knowledge/repo-map.md` and `.claude/knowledge/event-map.md` if they exist — every feature area/topic already recorded there is a flow candidate.
2. Read `.claude/knowledge/flows.md` if it exists (its absence is normal on a first run — create it fresh) and scan its Contents index / section headings to see what's already been documented — each existing section is also a candidate for a refresh, not just new discovery.
3. Look for the project's **cross-cutting core flows** first — these are usually the highest-value, most complex ones: search for a central case/workflow entity (something like a "Request"/"Case"/"Task" header table), any distinctly-named process folders (e.g. things named `process`, `config`, `background`, `integration`), and any docs already in the repo (e.g. an existing backend/architecture guide) that list named flows (Mass processing, batch/bulk variants, project/multi-step workflows, etc.) — read any such doc's table of contents for flow names rather than re-deriving from scratch if one already exists.
4. Then enumerate **per-domain flows**: every business-object/domain folder (e.g. under a `master-data`-style root) is its own flow, documented at the **same full depth** as a cross-cutting flow — not a shortened cross-reference. A domain rides on a shared cross-cutting mechanism just as often as it has its own logic, and both halves matter equally: trace the shared mechanism's actual behavior *as applied to this domain* (its real entity fields, its real status values, its real event topics, its real config) in full, in addition to whatever is genuinely domain-specific. "This part is inherited from the shared engine" is a fact worth stating plainly — it is not an excuse to skip tracing it for this domain.
5. Compile one master candidate list: flow name, why it's a candidate, and whether a doc already exists for it. Every entry gets the full template at full depth — there is no "lighter" tier. Group the list by cross-cutting vs. per-domain only to help sequence the work (see step 3's batching question), never to justify less detail for either group.

## 3. Present the full plan before running anything expensive

This step is not optional, regardless of how the skill was invoked — a whole-project run at full depth for every flow is a large, expensive operation, and the discovery step above is a guess that deserves a sanity check. Show the user:
- The full candidate list, grouped by cross-cutting/core vs. per-domain (grouping is only to help sequence batches — every entry gets identical full-depth treatment, there is no reduced tier).
- Which already have a knowledge document, which are new.
- A rough cost estimate (number of flows × typical fan-out size per flow — every flow, cross-cutting or per-domain, is roughly as expensive as this project's own Request-flow document, since every flow gets the same full template at full depth).

Then ask, in plain chat:
1. Does this list look right — anything to add, remove, merge, or split?
2. **For every flow that already has a section in `.claude/knowledge/flows.md`**: default policy — update that section in place, or always add a new version section alongside it without touching the original? Offer both a global default and the ability to call out specific flows for the opposite treatment (e.g. "update everything except the Request flow doc, version that one instead").
3. Given the likely size of this run, does the user want it done in one pass, or broken into batches (e.g. cross-cutting flows first, per-domain flows in a later run)? Batching only changes *when* each flow gets built — it never changes *how deep* — every flow, whichever batch it lands in, gets the full template below.

Wait for answers before fanning out any `smdg-flow-tracer` calls.

## 4. Per-flow execution

Every confirmed flow — cross-cutting or per-domain — runs the **same full pipeline at the same full depth**. There is no shortened path. A domain that mostly inherits behavior from a shared engine still gets that behavior traced and written out in full *as it applies to that domain* (real fields, real statuses, real topics, real config) — inheriting from a shared mechanism is a fact to state clearly, not a reason to write less.

1. **Decide which investigative angles apply** (schema/entities, event/messaging, per-role business logic, config/routing engine, background/scheduled jobs, retry/failure semantics, UI flow) — every angle that's genuinely relevant to this flow gets traced; don't skip one to save time.
2. **Fan out `smdg-flow-tracer`** once per repo+angle, in parallel. Typical size: 6-12 parallel tracers per flow — this doesn't shrink for a per-domain flow just because it shares a mechanism with others; the shared mechanism still needs tracing *for this domain's actual parameters* (its shortname, its specific config rows, its specific entity fields), which is genuine, non-generic work each time.
3. **Synthesize the reports yourself** into one Markdown *section* (all 14+ flows live together in the single file `.claude/knowledge/flows.md`, so a flow's own title is an `##` heading, not `#`, and everything nested under it shifts down one level accordingly) following this structure — every section that applies to this flow gets written out in full; skip a subsection only when it's genuinely not applicable (e.g. no background jobs exist for this flow at all), never to save effort:

   ```markdown
   ## <Flow name> — Deep Knowledge

   See `.claude/knowledge/glossary.md` for unfamiliar terms.

   > **Branch verified against: `<branch>`** for every repo cited, unless noted otherwise. [Cross-reference and note any known divergence with other existing docs for this system explicitly — don't silently pick a side if two sources disagree.]

   ### 1. Actors and services at a glance
   [table: role -> repo -> API path -> what it owns, in plain language]

   ### 2. Full status vocabulary
   [every status/enum value touched by this flow, in plain English, where each is set — cite the file]

   ### 3. Core data model
   [every entity, key fields, associations — cite the file, explain unfamiliar field names]

   ### 4. Full flow narrative
   [phase by phase, decision points as explicit if/else trees, not vague prose:]
   ```
   IF <condition, cite the file it's found in>
     -> <effect, in plain language>
   ELSE IF <condition>
     -> <effect>
   ELSE
     -> <effect>
   ```

   ### 5. Cross-cutting mechanism(s)
   [any shared hub/engine this flow routes through]

   ### 6. State machine (Mermaid `stateDiagram-v2`)

   ### 7. Sequence diagram (Mermaid `sequenceDiagram`, happy path)

   ### 8. Event Ledger
   [every topic, in full: emit site+payload fields, consume site, exact DB effect — every topic that's part of this flow, not just the "primary" ones. No lighter/grouped treatment for anything actually in scope; if something is genuinely out of scope for this flow, say so rather than compressing it.]

   ### 9. Retry & failure semantics
   [retryable-vs-not classification found in code, retry cap/backoff/DLQ presence or absence, swallowed-vs-propagated errors per path]

   ### 10. Background job catalog
   [if applicable: real trigger mechanism, cadence, what happens if never started after a fresh deploy]

   ### 11. Diagnostic guide
   [ordered, most-likely-first causes for each "stuck at X"/"Y never happens" symptom, each tied to something concrete to check]

   ### 12. Known gaps — needs human confirmation
   ```

   No "Revision history" section — track only "Last verified" date/branch at the top; a section updated in place gets refreshed there, not appended to.

4. **Write into `.claude/knowledge/flows.md`** (a single file — never create per-flow files or directories) per the update-vs-version choice made in step 3:
   - **First run ever / file doesn't exist yet**: create it with a short header (one line pointing to the glossary, one line explaining every flow keeps its own internal numbering) followed by a `## Contents` index linking to each flow's `##` heading, then every flow's section in turn, separated by `---`.
   - **Update in place**: find the flow's existing `##` section (match by its title, not by position) and replace its full contents, refreshing the "Last verified" line — leave every other flow's section untouched, in its original position.
   - **New version, keep the old one**: leave the existing section exactly where it is, and append a new section further down the file titled `## <Flow name> — Deep Knowledge (v<N+1> — <date>)`; add both the original and the new version to the `## Contents` index so a reader can find either.
   - **New flow, no existing section**: append a new `##` section at the end of the file (before any trailing notes) and add it to the `## Contents` index.
   - After any write, re-check that every `##`-level flow heading still has a matching entry in `## Contents` and that internal headings inside the section you touched are still one level deeper than the flow's own `##` (i.e. `###`, `####`, ...) — a flow's internal section numbers (its own "1.", "2.", ...) restart per flow and that's expected, not a bug to fix.

## 5. Final summary

Report, for the whole run: every flow processed, its section heading in `.claude/knowledge/flows.md`, whether it was a fresh section/update/new-version, and every item from every flow's §12 (known gaps) pulled inline — don't make the user scroll the whole file to find what's unverified.

## 6. If run again later

Re-running discovery naturally finds both previously-documented and newly-relevant flows — always re-present the plan (step 3) rather than silently redoing or skipping anything.
