# Root Cause Code Tracer (`smdg-root-cause-tracer`)

A subagent that turns a reproduced bug's symptoms into a precise, code-verified defect location — `file:line`, not a guess about which layer is at fault.

You normally don't invoke this agent directly — it's the third step of the `smdg-jira-fix-issue` pipeline, run after `smdg-jira-reproducer` has reproduced the bug and written a `## Failure Signature` section to `reproduction-findings.md` (endpoint, exact error text, feature area, evidence paths).

Depends on: nothing (no MCP servers, no browser tools — it works entirely off files already on disk plus the target codebase's own source).

If invoked directly, give it the ticket key and the path to `reproduction-findings.md`. It:
- Checks `.claude/knowledge/repo-map.md` for a known mapping from feature area to repo path(s) before doing anything else, so a previously-traced feature area is nearly free the second time.
- Otherwise routes cheaply: glob directory names across the codebase's ~200+ nested repos, keyword-match against the feature area, shortlist 2-3 candidates, then grep for a distinctive anchor string (usually the exact error text) — never a blind scan of every repo.
- Reads only the matched file(s), doing at most 2 bounded "who calls this" hops if the first match turns out to be a symptom-emitter (e.g. a validator) rather than the actual cause.
- Writes `.claude/evidence/<TICKET-KEY>/root-cause.md` with the final classification (UI bug / Backend bug / Contract-Schema Mismatch / Data-Environment Issue / Inconclusive), the exact file:line citation, and a minimal snippet.
- Appends what it learned to `.claude/knowledge/repo-map.md` so the next ticket in the same feature area skips rediscovery.

It stops and asks — rather than widening to a blind search — when: none of the shortlisted repos have a working tree checked out, the anchor grep finds nothing anywhere available, or a backward trace exceeds its 2-hop budget without resolving.

For Characteristic/Filter-Rule tickets specifically, it's careful not to confuse a rule's *configured field name* (e.g. `charcValue`) with the *runtime value* being selected (e.g. a Characteristic code like `MDG_FG_PLT`) — a known, recurring mix-up in this codebase that sends a naive anchor grep down a dead end.
