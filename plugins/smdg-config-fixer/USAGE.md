# Jira Config Fixer (`smdg-config-fixer`)

A subagent that applies an already-diagnosed **Data/Environment Issue** fix directly in a live Admin UI — e.g. deleting a broken Filter Rule row, correcting a bad lookup value — as the optional final stage of the `smdg-jira-fix-issue` pipeline.

You normally don't invoke this agent directly — it's the optional last step of the `smdg-jira-fix-issue` pipeline, run only after `smdg-root-cause-tracer` has produced `root-cause.md` and the user has agreed to have the fix applied automatically. Install that skill instead unless you're building a custom pipeline around this agent.

Depends on: `smdg-playwright-browsers` (installed automatically alongside this plugin).

## Scope

Only handles **Data/Environment Issue** classifications (bad config/reference/test data). It never runs for UI bug / Backend bug / Contract-Schema Mismatch classifications — those need an actual code change through your normal dev/PR workflow, not this agent. If invoked outside its scope, it refuses and says so.

## Safety behavior

- Confirms the logged-in account actually has edit/delete rights on the target screen before doing anything — stops and asks for an Admin-capable login if not.
- Always takes a screenshot of the exact records **before** and **after** the change — saved under `.claude/evidence/<TICKET-KEY>/screenshots/fix-before.png` and `fix-after.png` — never relies on text-only accessibility snapshots as proof of a state change.
- States the exact, itemized list of records it's about to change and waits for explicit go-ahead on that specific list — a prior "yes, fix it" in principle is not treated as approval for the specific rows it actually finds.
- Re-runs the original reproduction steps afterward to confirm the bug is actually gone, rather than assuming the config change worked.

## If invoked directly

Tell it: the ticket key, which browser to use (chrome/firefox/edge — it refuses to start otherwise), environment_url + credentials, and the exact change `root-cause.md` identifies.

## It writes

`.claude/evidence/<TICKET-KEY>/fix-summary.md` — what changed, screenshot paths, and whether live re-verification passed — plus the two screenshots above.
