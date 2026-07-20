# Jira Bug Investigation Pipeline (`smdg-jira-fix-issue`)

End-to-end Jira bug investigation: reads the ticket, reproduces it in a live environment, traces the failure to its exact file:line root cause in source, and classifies the bug.

## Usage

Either:
- Type `/smdg-jira-fix-issue <jira-ticket-url>`, or
- Just mention a Jira ticket link and ask Claude to investigate it — the skill's `description` is written so Claude can pick it up automatically, no slash command required.

You'll be asked a few questions in plain chat before anything happens:
1. How to read the ticket — open a browser (log in fresh each time), or via Jira MCP (one-time OAuth login, remembered afterward — see `smdg-jira-mcp`'s USAGE.md for setup)
2. If you chose browser mode: which browser to use to open the ticket (Chrome/Firefox/Edge)
3. Which browser to use to reproduce it on the test environment — always asked, regardless of how you chose to read the ticket, since reproduction is a separate step that still needs real browser automation

The reading-mode and browser choices are all independent — that's expected (e.g. you might read via MCP but still need Firefox for reproduction, or use a different browser for each browser-based step due to different login/auth per system).

## What it does

1. `smdg-jira-fetcher` reads the ticket — via browser or Jira MCP, your choice — and extracts the environment URL, credentials, and repro steps. If anything's missing or ambiguous, you'll be asked — nothing is guessed. Once you answer, the fetcher is invoked again to merge your answer back into the evidence trail (with provenance) before moving on. In MCP mode, it cannot visually inspect attachment images (the Jira MCP server has no attachment-download tool) — it notes this as a limitation in `ticket-summary.md` rather than silently skipping it; switch to browser mode for that ticket if a screenshot's actual content matters. If MCP isn't authenticated yet, you'll be told to run `claude mcp login smdg-atlassian` before it can continue.
2. `smdg-jira-reproducer` logs into the environment, reproduces the bug, and captures targeted network evidence (not full traffic dumps), including a structured Failure Signature (`reproduced: true/false`, endpoint, exact error text, feature area) for the next step to use. If it's blocked by missing precondition data (e.g. the specific record the ticket says to use doesn't exist in this environment) rather than an ambiguous step, it still writes this signature — derived from the ticket's own expected-vs-actual description and clearly marked `reproduced: false` — instead of just giving up.
3. If reproduction succeeded, tracing proceeds automatically. If it was blocked on a data/environment gap but a ticket-derived signature is available, you'll be asked whether to proceed with tracing anyway (result marked as not live-verified) or stop. If it was blocked with nothing to derive a signature from (login trouble, a genuinely ambiguous step), you're asked to resolve that instead.
4. `smdg-root-cause-tracer` takes the Failure Signature and locates the exact `file:line` in source responsible — routing cheaply across the codebase's many nested repos (using a growing `.claude/knowledge/repo-map.md` index to skip rediscovery on familiar feature areas), rather than guessing from symptoms.
5. You get a final, code-verified classification (UI bug / Backend bug / Contract-Schema Mismatch / Data-Environment Issue / Inconclusive) with an exact file:line citation, plus all evidence file paths. If the signature behind it was ticket-derived rather than live-observed, the summary says so explicitly.
6. **If the classification is Data/Environment Issue and a specific config fix was identified**, you're asked whether to have it applied automatically. If you agree, `smdg-config-fixer` navigates the Admin UI, confirms the exact records with you before touching anything, captures before/after screenshots, applies the change, and re-verifies the original bug is actually gone. It never runs for the other three classifications — those need an actual code change through your normal dev/PR workflow.

## Evidence output

Everything is written under `.claude/evidence/<TICKET-KEY>/` in your current project:
- `ticket-summary.md` — extracted ticket fields (tagged `source: ticket` or `source: user-provided in chat`), plus any API examples QA already pasted into the ticket, preserved verbatim
- `screenshots/` — ticket attachments, the reproduced error state, and (if a fix was applied) `fix-before.png`/`fix-after.png`
- `network/<NN>-<slug>.json` — one file per relevant API call, with the **full** request and response (not a truncated summary) so the bug can be fixed from these files alone; sensitive headers/tokens are redacted before writing
- `reproduction-findings.md` — preliminary, symptom-based classification + justification + Failure Signature block
- `root-cause.md` — the code-verified final classification, exact file:line citation(s), and a minimal offending snippet
- `fix-summary.md` — only if a config fix was applied: what changed, whether live re-verification passed

Consider adding `.claude/evidence/` to your project's `.gitignore` — it can contain credentials and screenshots.

Separately, `.claude/knowledge/repo-map.md` accumulates a feature-area → repo-path index across *all* tickets in the project (not per-ticket) — this is what lets `smdg-root-cause-tracer` skip rediscovery once a feature area has been traced before. It's a plain project file, not something this plugin installs or manages directly, so it's safe to commit or `.gitignore` per your team's preference.

## AI Studio

Once this plugin is installed, open `smdg ai studio` → **Plugins** → this plugin's detail page → **Evidence Explorer** to browse past investigations for the current project without digging through the file system.

## Dependencies installed alongside this skill

- `smdg-jira-fetcher`, `smdg-jira-reproducer`, `smdg-root-cause-tracer`, `smdg-config-fixer` (the four subagents)
- `smdg-playwright-browsers` (shared MCP browser bridge, pulled in transitively — needed regardless of reading mode, since reproduction and any applied fix always use it)
- `smdg-jira-mcp` (registers the Jira MCP server for the browser-free reading mode; see its own USAGE.md for the one-time `claude mcp login smdg-atlassian` setup)

## Upgrading from an older install

`smdg plugin update` only re-syncs a plugin's own files — it does not automatically install dependencies newly added to an existing plugin's `dependsOn` (like `smdg-root-cause-tracer` being added here in 1.2.0, `smdg-jira-mcp` in 1.4.0, and `smdg-config-fixer` in 1.5.0). If you already had this pipeline installed before this version, upgrade with both commands:

```
smdg plugin update smdg-jira-fetcher smdg-jira-reproducer smdg-jira-fix-issue
smdg plugin add smdg-root-cause-tracer smdg-jira-mcp smdg-config-fixer
```

Running `smdg plugin doctor` afterward will flag a `missing-dependency` issue if this step gets skipped.

Note: 1.5.0 also renames the reproducer's output file from `analysis.md` to `reproduction-findings.md` (a harness-level restriction was silently blocking every write to the old name) — if you have any external tooling or scripts reading `.claude/evidence/<TICKET-KEY>/analysis.md` directly, update it to the new filename.
