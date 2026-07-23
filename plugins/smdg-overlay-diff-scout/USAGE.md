# Customer/Core Overlay Diff Scout (`smdg-overlay-diff-scout`)

A subagent that compares a customer clone's repo tree against the core/Internal baseline and records, domain by domain, what's shared vs. customized — `.claude/knowledge/customers/<customer-slug>.md`.

You normally don't invoke this agent directly — it's the per-customer comparison step of the `smdg-knowledge-bootstrap` pipeline. It's built for a specific setup: customer clones are **separate directory trees with no shared git history with core**, so it compares directory structure and sampled file content, not `git diff` across branches.

Depends on: nothing (no MCP servers, no Bash — it works entirely off files already on disk, the same tool grants as every other agent in this catalog).

If invoked directly, give it a core repo path and a customer repo path (and optionally a domain scope to limit the comparison). It:
- Glob-compares each matching domain folder's file set first — a differing file set (files added/removed) is already conclusive evidence of customization, no content read needed.
- Only when file sets match exactly does it sample 3-5 high-signal files per domain and grep their structural anchors (function signatures, `srv.on(` registrations, entity names) against the customer's corresponding file.
- Always tags its confidence as `sampled` (never `full-diff` — it has no exact-diff tool access) and explicitly notes when sampling was partial, so a reader knows exactly how much to trust an "identical-to-core" verdict.
- Appends to `.claude/knowledge/customers/<customer-slug>.md`, one file per customer (not a single merged file across all customers), using the same append-only discipline as `repo-map.md`.

It stops and asks only when the customer repo path's top-level folder name doesn't obviously map to a customer slug — otherwise it proceeds without further questions.

## Knowledge output

`.claude/knowledge/customers/<customer-slug>.md` — a plain project file, not installed or managed by this plugin directly, safe to commit or `.gitignore` per your team's preference. One file per customer (glob `.claude/knowledge/customers/*.md` to see which customers have been mapped so far), one block per domain compared, tagging each as `identical-to-core`, `overridden`, `customer-only`, or `core-only-not-cloned`.
