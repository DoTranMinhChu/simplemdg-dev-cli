# Jira Bug Investigation Pipeline (`smdg-jira-fix-issue`)

End-to-end Jira bug investigation: reads the ticket, reproduces it in a live environment, traces the failure to its exact file:line root cause in source, and classifies the bug.

## Usage

Either:
- Type `/smdg-jira-fix-issue <jira-ticket-url>`, or
- Just mention a Jira ticket link and ask Claude to investigate it — the skill's `description` is written so Claude can pick it up automatically, no slash command required.

You'll be asked two questions in plain chat before anything happens:
1. Which browser to use to open the ticket (Chrome/Firefox/Edge)
2. Which browser to use to reproduce it on the test environment

These can be different browsers — that's expected (different login/auth per system).

## What it does

1. `smdg-jira-fetcher` reads the ticket and extracts the environment URL, credentials, and repro steps. If anything's missing or ambiguous, you'll be asked — nothing is guessed. Once you answer, the fetcher is invoked again to merge your answer back into the evidence trail (with provenance) before moving on.
2. `smdg-jira-reproducer` logs into the environment, reproduces the bug, and captures targeted network evidence (not full traffic dumps), including a structured Failure Signature (endpoint, exact error text, feature area) for the next step to use.
3. `smdg-root-cause-tracer` takes that Failure Signature and locates the exact `file:line` in source responsible — routing cheaply across the codebase's many nested repos (using a growing `.claude/knowledge/repo-map.md` index to skip rediscovery on familiar feature areas), rather than guessing from symptoms.
4. You get a final, code-verified classification (UI bug / Backend bug / Contract-Schema Mismatch / Data-Environment Issue / Inconclusive) with an exact file:line citation, plus all evidence file paths.

## Evidence output

Everything is written under `.claude/evidence/<TICKET-KEY>/` in your current project:
- `ticket-summary.md` — extracted ticket fields (tagged `source: ticket` or `source: user-provided in chat`), plus any API examples QA already pasted into the ticket, preserved verbatim
- `screenshots/` — ticket attachments + the reproduced error state
- `network/<NN>-<slug>.json` — one file per relevant API call, with the **full** request and response (not a truncated summary) so the bug can be fixed from these files alone; sensitive headers/tokens are redacted before writing
- `analysis.md` — preliminary, symptom-based classification + justification + Failure Signature block
- `root-cause.md` — the code-verified final classification, exact file:line citation(s), and a minimal offending snippet

Consider adding `.claude/evidence/` to your project's `.gitignore` — it can contain credentials and screenshots.

Separately, `.claude/knowledge/repo-map.md` accumulates a feature-area → repo-path index across *all* tickets in the project (not per-ticket) — this is what lets `smdg-root-cause-tracer` skip rediscovery once a feature area has been traced before. It's a plain project file, not something this plugin installs or manages directly, so it's safe to commit or `.gitignore` per your team's preference.

## AI Studio

Once this plugin is installed, open `smdg ai studio` → **Plugins** → this plugin's detail page → **Evidence Explorer** to browse past investigations for the current project without digging through the file system.

## Dependencies installed alongside this skill

- `smdg-jira-fetcher`, `smdg-jira-reproducer`, `smdg-root-cause-tracer` (the three subagents)
- `smdg-playwright-browsers` (shared MCP browser bridge, pulled in transitively)

## Upgrading from an older install

`smdg plugin update` only re-syncs a plugin's own files — it does not automatically install dependencies newly added to an existing plugin's `dependsOn` (like `smdg-root-cause-tracer` being added here in 1.2.0). If you already had this pipeline installed before this version, upgrade with both commands:

```
smdg plugin update smdg-jira-fetcher smdg-jira-reproducer smdg-jira-fix-issue
smdg plugin add smdg-root-cause-tracer
```

Running `smdg plugin doctor` afterward will flag a `missing-dependency` issue if this step gets skipped.
