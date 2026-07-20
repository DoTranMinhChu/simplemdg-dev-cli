# Jira Bug Reproducer & Analyst (`smdg-jira-reproducer`)

A subagent that logs into a live test environment, reproduces a bug, captures targeted network evidence, and classifies the root cause as UI or Backend.

You normally don't invoke this agent directly — it's the second step of the `smdg-jira-fix-issue` pipeline, run after `smdg-jira-fetcher` confirms the environment URL, credentials, and repro steps.

Depends on: `smdg-playwright-browsers` (installed automatically alongside this plugin).

If invoked directly, tell it which browser to use for this run — it refuses to start otherwise, and this may deliberately be a different browser than the one used to read the ticket (different login/auth per system is common). It writes:
- `.claude/evidence/<TICKET-KEY>/screenshots/` (error-state capture)
- `.claude/evidence/<TICKET-KEY>/network/<NN>-<slug>.json` — one file per relevant API call, each with the **full** request (method, URL, query params, headers, body) and response (status, headers, body), so the bug can be fixed from these files alone. Sensitive headers/fields (`Authorization`, `Cookie`, tokens, API keys) are redacted to `[REDACTED]` before writing.
- `.claude/evidence/<TICKET-KEY>/reproduction-findings.md` — **always written, even when reproduction is blocked**, so the pipeline never has to fall back to parsing chat text. Contains the preliminary, symptom-based classification (now including a distinct `Data/Environment Issue` bucket, not just UI/Backend/Inconclusive), the key request/response summarized inline, and a `## Failure Signature` block — `reproduced: true/false`, endpoint, error text, feature area, evidence paths — for `smdg-root-cause-tracer` to consume next. If the Write call is ever blocked by a harness-level restriction, the full content is returned verbatim in chat instead, and the orchestrating skill writes it to disk on the agent's behalf.

It stops and asks rather than guessing on login trouble (failed logins, CAPTCHA/OTP/2FA), an ambiguous reproduction step, or missing precondition data (e.g. the specific record the steps say to use doesn't exist in this environment) — but even when blocked, it writes `reproduction-findings.md` with `reproduced: false` first, and for a missing-data blocker it still derives a best-effort Failure Signature from the ticket's own expected-vs-actual description (clearly labeled as ticket-derived, not observed) so root-cause tracing can still proceed if the user chooses to. For an over-constrained/empty-result query it hasn't read the code for, it hedges between "Backend bug" and "Data/Environment Issue" rather than committing to one, since the two are indistinguishable from network evidence alone.
