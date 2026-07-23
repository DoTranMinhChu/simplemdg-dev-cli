# Flow Deep-Read Tracer (`smdg-flow-tracer`)

A subagent that deep-reads one repo (or a small set of related files) against a specific investigative question and reports back thorough, file-cited findings (which file, not which line — line numbers drift, file identity doesn't) — the single reusable "deep reader" that `smdg-build-knowledge` fans out to N times in parallel, once per repo/angle of whatever flow is being documented.

You normally don't invoke this agent directly — it has no fixed scope of its own; it reads exactly what it's told to read and answers exactly what it's asked. `smdg-build-knowledge` is the orchestrator that decides which repos matter for a given flow and writes each invocation's specific prompt.

Depends on: nothing (no MCP servers, no Bash requirement — though it will use Bash for a branch check if available and the checked-out content looks suspiciously thin).

Unlike `smdg-root-cause-tracer` (cheap, hop-capped, built for per-ticket triage) or `smdg-feature-cartographer` (a few bullet facts plus one paragraph), this agent is **not** token-disciplined — it's built for producing durable, deep knowledge, so a longer, more complete report is preferred over a trimmed one. It:
- Confirms it actually has real content to read before reporting anything (flags empty scaffolds/bare `.git` folders immediately).
- Checks other branches (`uat`/`dev`/`experiment`/etc.) if the checked-out content looks thin, since this codebase's branches are known to genuinely diverge — and states which branch its findings came from.
- Describes every branch of every `if`/`else`/`switch` it finds relevant to its assignment, not just the happy path — this is the raw material an if/else decision tree in the final document needs.
- States exact DB table/field effects (insert/update/delete) and exact event topic strings/payload fields, never approximated.
- Explicitly distinguishes code-verified facts from inferences made from a dependency it couldn't read directly.

## How it's typically assigned

`smdg-build-knowledge` dispatches it against angles like: schema/entity model, event topics + payloads for a given hub/role-service repo, one role-service's business logic (e.g. an approve/reject/activate handler with its full decision tree), a config/routing engine, background/scheduled jobs, retry/failure-handling logic, or a UI flow trace — mirroring exactly the kind of deep multi-agent investigation that produced this project's own Request-flow knowledge document.
