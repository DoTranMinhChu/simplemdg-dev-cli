---
name: smdg-jira-fix-issue
description: Investigate a QA bug ticket end-to-end — read the Jira ticket, reproduce the issue in the environment, capture evidence, and classify it as a UI bug or Backend bug. Use when the user provides a Jira ticket link and wants it investigated, or invoke directly with /smdg-jira-fix-issue <ticket-url>.
argument-hint: [jira-ticket-url]
---
The user wants to investigate this bug ticket: $ARGUMENTS

Before doing anything else, ask the user two simple questions in plain chat (no command line, no jargon — this must be usable by non-technical team members):

1. "Which browser should I use to open the ticket: Chrome, Firefox, or Edge?"
2. "And which browser should I use to reproduce it on the test environment?"

Wait for the user's answer to both before proceeding. Accept casual answers ("chrome", "the first one", "let's do firefox") and map them to one of: chrome, firefox, edge. If the answer is unclear, ask again in one short follow-up rather than guessing.

Once both are known:

1. Invoke the `smdg-jira-fetcher` subagent. In its task prompt, explicitly state: "Use the <browser-for-jira> browser for this run" (substituting the user's answer).
2. If it reports missing information (environment URL, credentials, or steps to reproduce), stop and relay its question to the user verbatim. Do not guess on its behalf.
3. Once environment/credentials/steps are confirmed, invoke the `smdg-jira-reproducer` subagent. In its task prompt, explicitly state: "Use the <browser-for-testenv> browser for this run" (substituting the user's second answer).
4. If it reports being blocked (login issue, ambiguous step), relay the question to the user and wait.
5. When analysis is complete, summarize the final classification (UI vs Backend) and cite the evidence file paths under `.claude/evidence/<TICKET-KEY>/`.

Note: both browser choices are independent — it's expected and common that the user picks a different browser for each step (e.g. Chrome for Jira, Firefox for the test environment) due to different login/auth on each.
