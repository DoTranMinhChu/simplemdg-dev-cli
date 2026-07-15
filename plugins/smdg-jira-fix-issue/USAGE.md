# Jira Bug Investigation Pipeline (`smdg-jira-fix-issue`)

End-to-end Jira bug investigation: reads the ticket, reproduces it in a live environment, captures evidence, and classifies the bug as UI or Backend.

## Usage

Either:
- Type `/smdg-jira-fix-issue <jira-ticket-url>`, or
- Just mention a Jira ticket link and ask Claude to investigate it — the skill's `description` is written so Claude can pick it up automatically, no slash command required.

You'll be asked two questions in plain chat before anything happens:
1. Which browser to use to open the ticket (Chrome/Firefox/Edge)
2. Which browser to use to reproduce it on the test environment

These can be different browsers — that's expected (different login/auth per system).

## What it does

1. `smdg-jira-fetcher` reads the ticket and extracts the environment URL, credentials, and repro steps. If anything's missing or ambiguous, you'll be asked — nothing is guessed.
2. `smdg-jira-reproducer` logs into the environment, reproduces the bug, and captures targeted network evidence (not full traffic dumps).
3. You get a final classification (UI bug / Backend bug / Both / Inconclusive) plus the evidence file paths.

## Evidence output

Everything is written under `.claude/evidence/<TICKET-KEY>/` in your current project:
- `ticket-summary.md` — extracted ticket fields, plus any API examples QA already pasted into the ticket, preserved verbatim
- `screenshots/` — ticket attachments + the reproduced error state
- `network/<NN>-<slug>.json` — one file per relevant API call, with the **full** request and response (not a truncated summary) so the bug can be fixed from these files alone; sensitive headers/tokens are redacted before writing
- `analysis.md` — final classification + justification, with the key request/response summarized inline so the root cause is visible without opening another file

Consider adding `.claude/evidence/` to your project's `.gitignore` — it can contain credentials and screenshots.

## AI Studio

Once this plugin is installed, open `smdg ai studio` → **Plugins** → this plugin's detail page → **Evidence Explorer** to browse past investigations for the current project without digging through the file system.

## Dependencies installed alongside this skill

- `smdg-jira-fetcher`, `smdg-jira-reproducer` (the two subagents)
- `smdg-playwright-browsers` (shared MCP browser bridge, pulled in transitively)
