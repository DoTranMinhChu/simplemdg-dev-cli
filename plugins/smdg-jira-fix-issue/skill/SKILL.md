---
name: smdg-jira-fix-issue
description: Investigate a QA bug ticket end-to-end — read the Jira ticket, reproduce the issue in the environment, trace the failure to its exact file:line root cause in source, and classify it as a UI bug, Backend bug, Contract/Schema Mismatch, or Data/Environment Issue. Use when the user provides a Jira ticket link and wants it investigated, or invoke directly with /smdg-jira-fix-issue <ticket-url>.
argument-hint: [jira-ticket-url]
---
The user wants to investigate this bug ticket: $ARGUMENTS

Before doing anything else, ask the user two simple questions in plain chat (no command line, no jargon — this must be usable by non-technical team members):

1. "Which browser should I use to open the ticket: Chrome, Firefox, or Edge?"
2. "And which browser should I use to reproduce it on the test environment?"

Wait for the user's answer to both before proceeding. Accept casual answers ("chrome", "the first one", "let's do firefox") and map them to one of: chrome, firefox, edge. If the answer is unclear, ask again in one short follow-up rather than guessing.

Once both are known:

1. Invoke the `smdg-jira-fetcher` subagent. In its task prompt, explicitly state: "Use the <browser-for-jira> browser for this run" (substituting the user's answer).
2. If it reports missing information (environment URL, credentials, or steps to reproduce), stop and relay its question to the user verbatim. Do not guess on its behalf. Once the user answers, invoke `smdg-jira-fetcher` again for the same ticket and browser, explicitly passing along the user's answer and instructing it to merge it into `ticket-summary.md` (with provenance) and re-run its completeness check — don't forward the answer straight to the reproducer yourself. Repeat this loop until the fetcher reports everything is confirmed.
3. Once environment/credentials/steps are confirmed, invoke the `smdg-jira-reproducer` subagent. In its task prompt, explicitly state: "Use the <browser-for-testenv> browser for this run" (substituting the user's second answer).
4. If it reports being blocked (login issue, ambiguous step), relay the question to the user and wait.
5. If the reproducer reached the error state and its `analysis.md` includes a `## Failure Signature` section, invoke the `smdg-root-cause-tracer` subagent, giving it the ticket key and telling it to read that section. If it reports being blocked (repo not checked out, ambiguous feature area, no anchor match), relay its question to the user and wait. If the reproducer was instead blocked or explicitly could not reproduce the issue, skip this step entirely — there's nothing to trace — and go straight to relaying its blocker.
6. When analysis is complete, summarize the final result: prefer the tracer's code-verified classification and `root-cause.md` citation when available (UI bug / Backend bug / Contract-Schema Mismatch / Data-Environment Issue / Inconclusive); fall back to the reproducer's preliminary classification if the tracer had to stop and ask without a confident answer. Cite all relevant evidence file paths under `.claude/evidence/<TICKET-KEY>/`.

Note: both browser choices are independent — it's expected and common that the user picks a different browser for each step (e.g. Chrome for Jira, Firefox for the test environment) due to different login/auth on each.
