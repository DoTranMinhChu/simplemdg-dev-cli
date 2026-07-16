# Jira Ticket Fetcher (`smdg-jira-fetcher`)

A subagent that reads a Jira ticket via browser and extracts what's needed to reproduce the bug: environment URL, credentials, steps to reproduce, and attachments.

You normally don't invoke this agent directly — it's the first step of the `smdg-jira-fix-issue` pipeline. Install that skill instead unless you're building a custom pipeline around this agent.

Depends on: `smdg-playwright-browsers` (installed automatically alongside this plugin).

If invoked directly (e.g. via the Task tool), tell it which browser to use for this run (chrome/firefox/edge) — it refuses to start otherwise. It writes:
- `.claude/evidence/<TICKET-KEY>/ticket-summary.md` — including a verbatim "Provided API examples" section whenever QA already pasted a curl command, JSON payload, or HAR/DevTools excerpt into the ticket (redacted of any real credential/token first)
- `.claude/evidence/<TICKET-KEY>/screenshots/` (only when a ticket attachment genuinely needs visual inspection)

It stops and asks a specific question — rather than guessing — if the environment URL, credentials, or steps to reproduce are missing or ambiguous.

If called again for a ticket it already wrote a summary for — this time with the user's answer to its own question — it merges the answer into the existing `ticket-summary.md` (tagged `source: user-provided in chat`, distinct from `source: ticket`) and re-runs its completeness check, so the evidence trail always reflects what actually happened rather than going stale the moment a human fills a gap.
