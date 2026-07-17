# Jira MCP (`smdg-jira-mcp`)

Registers Atlassian's official remote MCP server (`smdg-atlassian`), so agents can read Jira tickets as structured data instead of driving a browser. Named `smdg-atlassian` rather than a generic `atlassian` so it never collides with an MCP server you may have already registered yourself under that name.

## One-time setup

Right after installing, run:

```
claude mcp login smdg-atlassian
```

This opens a browser for a one-time OAuth 2.1 login/consent. On a remote/SSH box with no local browser, use `claude mcp login smdg-atlassian --no-browser` instead.

After that, **Claude Code caches and auto-refreshes the session itself** — nothing to copy/paste, and no re-authentication on future runs. If the session ever breaks or is revoked, just re-run the same login command (or type `/mcp` inside a Claude Code session).

## What it's for

This plugin only registers the MCP server — it doesn't do anything on its own. `smdg-jira-fetcher` (part of the `smdg-jira-fix-issue` pipeline) depends on it and uses its tools (`mcp__smdg-atlassian__getJiraIssue`, `mcp__smdg-atlassian__searchJiraIssuesUsingJql`, etc.) as an alternative to opening a browser, when you choose "MCP" as the reading mode.

## Known limitation

This server exposes issue/project/metadata reads, not attachment file downloads — it can tell you an attachment's filename if the ticket data includes it, but it cannot fetch or display the actual image/screenshot content. If a ticket's evidence is a screenshot you need to see, use browser mode for that ticket instead.
