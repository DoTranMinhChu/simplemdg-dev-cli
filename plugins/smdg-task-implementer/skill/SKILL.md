---
name: smdg-task-implementer
description: General-purpose discipline for implementing ANY task in the SimpleMDG multi-repo CAP codebase — a new action/endpoint, a UI feature, a config-driven engine change, a schema change, a fix beyond bug triage. Verifies every claim (design docs, ticket descriptions, your own assumption about how a shared helper behaves) against the real current source before building on it, scopes the task across whichever repos it actually touches, implements per the target module's own real conventions, verifies empirically per module, uses correct git discipline, and knows how to find the real evidence when something breaks instead of guessing. Not specific to any one kind of change — use whenever the user wants something built, changed, or fixed in this codebase (not a from-scratch bug investigation of an existing report — see smdg-jira-fix-issue for that).
argument-hint: [what you're implementing, e.g. a ticket key or a one-line description]
---

The user wants to implement this: $ARGUMENTS

This codebase (SimpleMDG: 200+ independent nested repos, layered db → helper → srv → ui,
SAP CAP/CDS) rewards one discipline regardless of what kind of task you're doing: **treat
every claim about how the code currently behaves as a hypothesis until you've checked it
against the real, current source — including claims from design docs that say they were
already verified, and including your own assumption that a shared helper does what its
name or doc comment suggests.** Two real, unrelated things went wrong on the same real
task despite careful review: a design guide's own worked example put a field one
composition level away from where the real schema actually declares it, and a shared
helper several engines rely on turned out to only support one level of nesting it was
never explicitly documented as being limited to. Neither was a typo, and neither was
specific to CDS/composition work — they're both instances of the same general risk: an
assumption inherited from a doc, a memory of a similar pattern, or a name/comment, standing
in for an actual read of the current source. This skill exists to make checking that
routine, whatever the task turns out to be.

## Phase 0 — Load durable knowledge before starting

1. Read `.claude/knowledge/cds-gotchas.md` in the target project if it exists (its absence
   is normal on a first run — seed it at the end of this run instead of treating this as an
   error). Treat every entry as a hypothesis to spot-check cheaply, not a fact to skip
   re-verifying — code changes over time, entries can go stale.
2. Read `.claude/knowledge/repo-map.md` and `.claude/knowledge/features/<slug>.md` if they
   exist and a matching feature area is present (built by this CLI's other plugins —
   `smdg-root-cause-tracer`, `smdg-feature-cartographer`, `smdg-build-knowledge`). Reuse
   what they already resolved instead of re-deriving it.

## Phase 1 — Scope the task across the real repo layout

Identify every repo/module the task actually touches before writing anything — in a
200+-repo, layered (`db_*` → `helper_*` → `srv_*` → `ui_*`) codebase, a task that "sounds
like one change" commonly needs coordinated edits across 2-4 independently-versioned
repos (a schema repo, a pure-logic helper repo, the service repo that wires it in, and
sometimes a UI repo). List them explicitly. If the task description doesn't make the full
list obvious, confirm scope with the user before starting rather than discovering a missing
repo midway.

## Phase 2 — Verify every real claim before building on it

Whatever the task is, before writing code that depends on a specific fact about the
existing system, confirm that fact against the current real source — not a design doc, not
a ticket's own description, not a colleague's PR comment, not an existing test's stated
assumption, not your memory of how a similar-looking piece of this codebase works
elsewhere. All of those can be stale, incomplete, or simply wrong, even when they read as
authoritative. Two concrete ways this has actually bitten on this codebase, given as
illustrations of the general risk rather than an exhaustive list:

- **A schema/contract claim can be wrong even in a doc that says it verified against
  source.** When a doc asserts "field X belongs to entity Y" or "this is a child of that,"
  don't just confirm the property name exists somewhere in the relevant file — confirm
  which entity's block it's actually declared inside (entity declarations in this
  codebase's `.cds` files commonly span 50-300+ lines, and a property near the bottom of
  one entity's block can be visually close to the next entity's declaration in a
  grep's line-number output — an easy place to misattribute).
- **A shared helper's real behavior can differ from its name, its doc comment, or a
  similar-sounding sibling's behavior.** Before depending on a shared utility/engine doing
  something non-trivial (resolving a nested path, applying a default, deriving a key), read
  its actual implementation for that specific case, not just its exported type signature.

The general habit, not the specific examples above, is what to carry into any task: name
the concrete facts your implementation will depend on, and check each one against real,
current source before writing code against it.

## Phase 3 — Test non-trivial shared-code assumptions empirically, not just by reading

When the task depends on existing shared code behaving a specific way in a situation that
isn't already covered by a test you can point to — an edge case, a deeper/different input
shape than anything already exercised, an unusual combination of config, a code path
you're inferring from a similar-looking sibling rather than confirmed for this exact
case — reading the implementation is necessary but not sufficient. Write a minimal,
throwaway reproduction (a scratch test in the owning repo if its toolchain is available, or
a standalone script reproducing just the relevant logic if it isn't) that exercises the
actual case your task needs, and run it for real.

If it reveals the shared code doesn't do what was assumed:
- Decide explicitly whether fixing it is in scope for this task, or whether to design
  around the limitation instead — and say which you chose and why, rather than silently
  picking one.
- If you fix it, fix it **generally** — for the whole class of case your reproduction
  exposed, not narrowly for the one instance the current task happens to need. A fix that
  only covers today's specific shape re-breaks the next time someone needs a slightly
  different one.
- If the fix touches code shared by callers you haven't audited today, say so explicitly
  in a comment and to the user — don't silently leave an identical defect undiscovered
  elsewhere, and don't silently "fix" it everywhere either without the user's sign-off,
  since other callers may depend on today's behavior in ways you haven't checked.

## Phase 4 — Implement per the target module's own real conventions

This codebase is not internally consistent about several of its own conventions — read the
**specific module you're editing's** own files for its real convention, not a
codebase-wide assumption:
- Real TypeScript `enum`s for closed sets of config values, not string-literal unions —
  check every comparison/switch site gets updated to the enum member, not just the type
  declaration.
- Comments earn their place by explaining a non-obvious decision (why this differs from a
  sibling pattern, what a placeholder still needs, why a fallback exists) — not by
  restating what the code already says. Prefer a generic/abstract example over one tied to
  the current ticket's specific business entities when the code being commented is shared
  infrastructure that will plausibly serve other cases later.
- Read the module's actual `jest.config.js`/`tsconfig.json`/lint config before writing a
  test or new file — only a minority of services in this codebase share a common preset;
  assuming one project-wide convention applies everywhere is a frequent, avoidable mistake.
- For CDS entities specifically: confirm whether the area you're editing declares entities
  singular-with-`@plural` or already plural before assuming which one this specific module
  follows, and remember `@plural` only changes the OData collection/generated-type name —
  never the physical database table name, which always follows the entity's own literally
  declared name.

## Phase 5 — Verify empirically, per module, not once for the whole task

1. For each repo touched, run that module's own real verification: `tsc --noEmit` and
   `jest` for a TS/CAP service, `cds build --production` (and a real model-type
   regeneration if the project uses `cds-typer`) for anything with `.cds` changes, that
   module's own build/lint/test for a UI repo. Reading the code and concluding it should
   work is not verification.
2. Treat `node_modules`, generated model directories, and other gitignored build output as
   **not guaranteed to still be in the state you last observed** — re-check they exist and
   contain what you expect before trusting a build/test run's clean result, especially
   after a git worktree operation, a long gap between commands, or switching which repo
   you're working in. A missing generated directory produces a wall of unrelated-looking
   import errors that can look like a real regression; regenerate first, then re-assess.
3. When a change spans repos published as versioned packages to a private registry (a
   local edit in one repo is invisible to another repo's installed copy of it until merged
   and republished), verify the end-to-end effect using the actual published/installed
   artifact where practical, not just the source repo in isolation — a stale bundled
   copy of a model/type/compiled-dist file in a *different* repo's `node_modules` is a
   real, recurring failure mode here.
4. Prove a fix doesn't regress anything by running the affected suite once with the fix
   applied and once with it `git stash`-ed out, and diffing the two failure lists — a
   failure count that reproduces identically with the fix stashed out is pre-existing;
   cite that diff, not "tests were already failing," as the actual evidence.

## Phase 6 — Git discipline

- Before amending: check the target branch's actual tip commit. If it's the feature commit
  itself, `git commit --amend` is safe and keeps a "1 commit per MR" convention intact. If
  the tip is a merge commit, or has already been merged into the base branch, amending
  would rewrite history that's already elsewhere — make a new commit instead and say so
  explicitly, rather than silently accepting two commits or forcing a rebase.
- Never commit/push without either standing authorization for this class of change or
  explicit confirmation for this specific change — especially for a fix that goes beyond
  the task's originally-stated scope (a shared-code defect found and fixed along the way),
  since that's new scope the user hasn't necessarily agreed to ship yet.

## Phase 7 — When something breaks after shipping, find the real evidence before guessing

The method is general — find the actual evidence trail for whatever layer you're debugging
— even though where that evidence lives differs by task type. Know, or find out, where
this class of failure gets recorded before speculating from the symptom alone:
- Backend/process-engine work (a request/CR that fails after your change ships): this
  codebase's process/request engine records failures in real DB columns — a request-level
  log column, item-level error columns, and per-task log columns, each keyed by the
  request/item/task ID. Confirm the actual table/column names for the target project the
  same way as Phase 2 (grep the real schema; don't assume a name from memory of a
  different project or a different area of this one).
- Server-side logic errors: the service's own `cds.log`-style output, or whatever the
  target module's real logging convention is — check it, don't assume it's silent.
- UI-side issues: the browser console and network tab, not a guess about what the backend
  "probably" returned.
- CI/pipeline failures: the actual job output, not the commit that preceded it.

If the real evidence points to a genuine code defect (not a data/config gap): that's a bug
in the target codebase, fix it with the same rigor as Phases 2-5, or hand off to this
CLI's `smdg-jira-fix-issue` pipeline if it needs a full Jira-ticket-shaped investigation
trail rather than an inline fix during this task.

## Phase 8 — Record what you learned for the next task

Append an entry to `.claude/knowledge/cds-gotchas.md` (create it, and its parent directory,
if it doesn't exist yet) for any genuinely reusable landmine this task surfaced —
regardless of whether it was about a UI convention, a service's real config, a database
schema fact, or a shared engine's actual behavior. This file is **append-only**, same
discipline as this CLI's `repo-map.md`/`event-map.md`: never edit or delete an existing
entry, even a stale-looking one — append a corrected/updated entry instead, so the history
of what was believed and when stays legible. Format:

```markdown
## <Short, greppable name for the gotcha>
- area: <module/engine/table/convention this applies to>
- what: <the actual behavior, stated as fact, not as "might be">
- how confirmed: <the real command/test/read that proved it — cite it, don't just assert>
- consequence: <what goes wrong if you don't know this>
- last_confirmed: <task/ticket reference> (<date, if known>)
```

Do not record task-specific business facts here (a particular ticket's field mapping, a
particular customer's config values) — only facts about how the shared code/schema/
convention itself behaves, since that's what stays true across tasks and is expensive to
re-discover each time.
