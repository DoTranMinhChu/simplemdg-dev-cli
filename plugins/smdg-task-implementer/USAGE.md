# Task Implementation Discipline (`smdg-task-implementer`)

A **general-purpose** verify-before-trust discipline for implementing any task in the
SimpleMDG multi-repo CAP codebase — a new action/endpoint, a UI feature, a config-driven
engine change, a schema change, a fix beyond bug triage. Not specific to any one kind of
change. Not for investigating an existing bug report from scratch (`smdg-jira-fix-issue`),
and not for mapping/documenting existing flows (`smdg-build-knowledge`,
`smdg-feature-cartographer`).

## Why this exists

Two real, unrelated things went wrong on the same real task despite careful review:

1. A design guide's own worked example (already stated as "verified against source code")
   put a field one level away from where the real schema actually declares it — an easy
   mistake when a grep match's line number sits visually close to a *different*
   declaration in the same file.
2. A shared helper several engines relied on turned out to only support one level of
   nesting it was never explicitly documented as being limited to — silently doing nothing
   past that, no exception, no build error.

Neither was a typo, and neither is specific to CDS/schema work — both are the same general
risk: an assumption inherited from a doc, a memory of a similar pattern, or a name/comment,
standing in for an actual read of the current source. This skill turns "check it for real"
into a repeatable habit, whatever the task turns out to be.

## Usage

Either:
- Type `/smdg-task-implementer <what you're implementing>`, or
- Just describe the task you want implemented in this codebase and mention this skill —
  its `description` is written so it can be picked up automatically.

## What it does

Eight phases, run in order for each task — general at every step, with concrete
illustrations (not requirements) drawn from real CDS/composition experience where useful:

0. **Load durable knowledge** — reads `.claude/knowledge/cds-gotchas.md` (this plugin's
   own accumulating knowledge file, despite the name not limited to CDS-specific facts)
   plus this CLI's other knowledge files if they exist, before starting.
1. **Scope the task across the real repo layout** — identifies every repo/module actually
   touched; in a 200+-repo, layered (`db_*`→`helper_*`→`srv_*`→`ui_*`) codebase this is
   rarely just one repo.
2. **Verify every real claim before building on it** — any assertion about how the
   existing system behaves (a doc, a ticket description, a colleague's comment, your own
   memory of a similar pattern) is treated as a hypothesis to check against current real
   source, not a fact.
3. **Test non-trivial shared-code assumptions empirically** — when the task depends on
   existing code behaving a specific way in a case no existing test already covers, proves
   it with a real throwaway reproduction rather than a read-through alone, and fixes any
   defect found generally (the whole class of case) rather than narrowly.
4. **Implement per the target module's own real conventions** — real enums, comments that
   explain non-obvious decisions, and each module's own actual test/lint/build config
   respected rather than assumed from a codebase-wide convention that doesn't actually hold
   everywhere.
5. **Verify empirically, per module** — real build/test for whatever the module type
   actually is, generated directories re-checked rather than assumed stable, cross-repo
   published-package staleness checked against the real installed artifact, and a
   `git stash` A/B to prove any fix doesn't regress something that already passed.
6. **Git discipline** — checks whether the target branch's tip is safe to amend or needs a
   new commit before touching history, and never commits/pushes without authorization for
   that specific change.
7. **When something breaks after shipping, finds real evidence before guessing** — knows
   (or finds out) where the relevant failure trail lives for the layer being debugged: DB
   log/error columns for process-engine work, service logs for backend logic, browser
   console/network for UI, CI job output for pipeline failures.
8. **Records new gotchas** — appends any genuinely reusable landmine (not task-specific
   business facts) to `.claude/knowledge/cds-gotchas.md`, append-only, same discipline as
   this CLI's `repo-map.md`/`event-map.md`, regardless of what kind of task surfaced it.

## Knowledge output

`.claude/knowledge/cds-gotchas.md` in your current project — one entry per confirmed,
reusable landmine about how the shared code/schema/convention itself behaves (UI, backend,
database, process engine, build tooling — whatever the task surfaced), not per-ticket
business facts. Grows across every task run with this skill, the same way `repo-map.md`
grows across every bug investigated with `smdg-jira-fix-issue`.

## Relationship to this CLI's other plugins

- **`smdg-jira-fix-issue`** — for investigating an *existing* reported bug end-to-end
  (reproduce → trace → classify → optionally fix config). Use this plugin instead when
  you're *building* something, and hand off to `smdg-jira-fix-issue` mid-task only if a
  real-evidence check in Phase 7 surfaces a defect that needs a full Jira-ticket-shaped
  investigation trail rather than an inline fix.
- **`smdg-build-knowledge` / `smdg-feature-cartographer` / `smdg-root-cause-tracer`** —
  read from `.claude/knowledge/repo-map.md`/`features/<slug>.md` if they exist (Phase 0),
  but this plugin does not require them and does not generate them itself.
- **`smdg-config-fixer`** — edits live Admin UI config directly for an already-diagnosed
  data/environment issue. This plugin is for code/schema/config-row implementation work,
  not live-environment mutation.

## Dependencies

None — this is a self-contained skill with no subagents or MCP servers of its own.
