# Jira Ticket Fetcher (`smdg-jira-fetcher`)

A subagent that reads a Jira ticket — via browser or Jira MCP — and extracts what's needed to reproduce the bug: environment URL, credentials, steps to reproduce, and attachments.

You normally don't invoke this agent directly — it's the first step of the `smdg-jira-fix-issue` pipeline. Install that skill instead unless you're building a custom pipeline around this agent.

Depends on: `smdg-playwright-browsers` and `smdg-jira-mcp` (both installed automatically alongside this plugin) — one for each reading mode below.

If invoked directly (e.g. via the Task tool), tell it which reading mode to use for this run:
- **`browser`** — also tell it which browser (chrome/firefox/edge); it refuses to start otherwise. Logs in fresh each run.
- **`mcp`** — reads via `mcp__smdg-atlassian__*` tools instead (no browser, no per-run login — see `smdg-jira-mcp`'s USAGE.md for the one-time OAuth setup). Cannot visually inspect attachment images (no download tool exists on that server) — it'll note this as a limitation in `ticket-summary.md` rather than silently skipping it. If MCP isn't authenticated yet, it stops and tells you to run `claude mcp login smdg-atlassian`.

It writes:
- `.claude/evidence/<TICKET-KEY>/ticket-summary.md` — including a verbatim "Provided API examples" section whenever QA already pasted a curl command, JSON payload, or HAR/DevTools excerpt into the ticket (redacted of any real credential/token first)
- `.claude/evidence/<TICKET-KEY>/screenshots/` (`browser` mode only, and only when a ticket attachment genuinely needs visual inspection)

It stops and asks a specific question — rather than guessing — if the environment URL, credentials, or steps to reproduce are missing or ambiguous.

If called again for a ticket it already wrote a summary for — this time with the user's answer to its own question — it merges the answer into the existing `ticket-summary.md` (tagged `source: user-provided in chat`, distinct from `source: ticket`) and re-runs its completeness check, so the evidence trail always reflects what actually happened rather than going stale the moment a human fills a gap.
