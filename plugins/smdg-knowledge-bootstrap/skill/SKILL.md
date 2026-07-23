---
name: smdg-knowledge-bootstrap
description: Deliberately invoked (not per-bug-ticket) orchestrator that compares a core baseline against 1-3 customer clones to record shared-vs-customized domain folders, and optionally traces a named feature end-to-end (UI -> API -> DB -> event) into a Feature Card. Use when the user wants to build/refresh a shared-vs-customized knowledge base, or wants a feature's FE/BE/DB shape documented. Invoke with /smdg-knowledge-bootstrap <core-path> <customer-path...>.
argument-hint: [core-path] [customer-path...]
---
The user wants to build or refresh project knowledge for: $ARGUMENTS

1. Parse `$ARGUMENTS`: the first path given is the core/Internal baseline, everything after it is 1-3 customer clone paths. If no paths were given, or it's unclear which one is core, ask in plain chat rather than guessing — e.g. "Which path is the core/Internal baseline, and which one(s) are customer clones?"

2. Ask once, up front (not per-domain, not per-customer): "Bạn có muốn tôi trace luôn một tính năng cụ thể theo dạng UI → API → Database → Event không? Nếu có, tên tính năng là gì?" ("Do you also want me to trace a specific feature end-to-end — UI → API → Database → Event? If so, what's the feature name?"). This decides whether step 4 runs at all this pass — it's fine for the answer to be "no, just the overlay comparison for now."

3. For each customer path given, invoke the `smdg-overlay-diff-scout` subagent with the core path and that customer path (and any domain scope the user mentioned). Relay its per-domain summary table. If the customer path's top-level folder name doesn't obviously read as a customer name, confirm the slug it used with the user before moving to the next customer.

4. If the user asked for a feature trace in step 2, invoke the `smdg-feature-cartographer` subagent once per feature name given, telling it explicitly whether to trace against the core path, a specific customer path, or both (ask if it wasn't already clear from step 2's answer). Relay its Feature Card path and the headline `ui_entry_point`/`api_handler`/`db_entity`/`event_emitted` facts.

5. **Final summary**: list every knowledge file touched this run (`.claude/knowledge/customers/<slug>.md` per customer, `.claude/knowledge/features/<feature-slug>.md` if step 4 ran), and explicitly surface anything either subagent flagged as needing human confirmation — a low-confidence sampled comparison, an unresolved trace hop, etc. Don't make the user open every file themselves to find these; pull the relevant lines into your summary directly.

Note: this pipeline is meant to be re-run as the codebase evolves — a later run against the same core/customer pair refines the existing `customers/<slug>.md` entries and Feature Cards rather than starting over, since both subagents check what's already recorded before re-deriving it from scratch.
