# Jira Bug Reproducer & Analyst (`smdg-jira-reproducer`)

A subagent that logs into a live test environment, reproduces a bug, captures targeted network evidence, and classifies the root cause as UI or Backend.

You normally don't invoke this agent directly — it's the second step of the `smdg-jira-fix-issue` pipeline, run after `smdg-jira-fetcher` confirms the environment URL, credentials, and repro steps.

Depends on: `smdg-playwright-browsers` (installed automatically alongside this plugin).

If invoked directly, tell it which browser to use for this run — it refuses to start otherwise, and this may deliberately be a different browser than the one used to read the ticket (different login/auth per system is common). It writes:
- `.claude/evidence/<TICKET-KEY>/screenshots/` (error-state capture)
- `.claude/evidence/<TICKET-KEY>/network/<NN>-<slug>.json` — one file per relevant API call, each with the **full** request (method, URL, query params, headers, body) and response (status, headers, body), so the bug can be fixed from these files alone. Sensitive headers/fields (`Authorization`, `Cookie`, tokens, API keys) are redacted to `[REDACTED]` before writing.
- `.claude/evidence/<TICKET-KEY>/analysis.md` (final classification, with the key request/response summarized inline, not just referenced)

It stops and asks rather than guessing on login trouble (failed logins, CAPTCHA/OTP/2FA) or an ambiguous reproduction step.
