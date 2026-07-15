# Playwright Browser Bridge

Registers three MCP servers at **user scope** (machine-wide, not per-project), regardless of which scope the overall install was for — browser availability is a machine concern, not a per-repo one:

- `playwright-chrome`
- `playwright-firefox`
- `playwright-edge`

All three wrap the same `@playwright/mcp@latest` package, each pinned to a different browser via `--browser`. Any agent that depends on this plugin gets tool access via `mcp__playwright-<browser>__*`.

You normally won't install this directly — it's pulled in automatically as a dependency by plugins that need browser automation (e.g. `smdg-jira-fetcher`, `smdg-jira-reproducer`).

Verify registration any time with:

```
claude mcp list
```

If Claude Code was already running when this installed, restart it (exit and run `claude` again) so the new MCP servers load.
