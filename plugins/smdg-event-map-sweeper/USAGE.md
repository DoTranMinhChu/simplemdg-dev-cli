# Event/Queue Map Sweeper (`smdg-event-map-sweeper`)

A subagent that sweeps a set of repos you name for SAP CAP messaging patterns and builds a cross-referenced producer/consumer index of event topics — `.claude/knowledge/event-map.md`.

You normally invoke this deliberately, not per bug ticket — think of it as bootstrapping or refreshing knowledge, the same way you'd point `smdg-knowledge-bootstrap` at a set of repos. `smdg-root-cause-tracer` reads (and incrementally appends to) `event-map.md` on its own whenever a ticket's symptoms look event/queue-shaped, but it never runs this sweeper itself — the sweeper is a separate, wider pass you run when you want the map to cover more ground than what individual tickets have happened to touch.

Depends on: nothing (no MCP servers, no browser tools — it works entirely off files already on disk).

Give it either:
- A specific list of repo paths or domain-folder names to sweep, or
- "All" — in which case it reads `.claude/knowledge/repo-map.md` and sweeps every repo already marked `status: checked-out` there. If that map doesn't exist yet, it will ask you which folders to sweep instead of guessing.

It classifies each swept repo before deciding how to sweep it:
- **Shared-engine consumers** (an object-type's own `_process` repo, e.g. `simplemdg_srv_prd_process`): these have no messaging code of their own — they import a shared workflow-engine package parameterized by `OBJECT_TYPE`/`OBJECT_SHORTNAME`. The sweeper reads the shared package's event-registration file **once per sweep** to build a fixed action catalog (`StartActivate`, `InsertFinal`, `StartTestrun`, etc. — identical across every domain), resolves each repo's `OBJECT_SHORTNAME` from its own env/deployment config, and **computes** its topic set as `${shortname}${Action}` instead of grepping for it (grepping would find nothing, since the string is built at runtime).
- **Hub/role-service repos** (e.g. `..._process_event`, `..._process_approver`, `..._config_system`, `..._background`): these DO have real, repo-local `messaging.on`/`messaging.emit` calls — the sweeper greps these directly (filtered to topic-shaped first arguments), plus `cds.connect.to('messaging')` and messaging/destination keys in `mta.yaml`/`.cdsrc.json`/`package.json`.
- Skips any target repo that isn't actually checked out (a bare `.git` folder), noting it rather than failing the whole sweep.
- Cross-references matches (both computed and grepped) by normalized topic string across every repo it swept, so one topic's producer and all its known consumers land in a single `event-map.md` entry.
- Appends to `event-map.md` (creating it if needed) using the same append-only discipline as `repo-map.md` — existing entries are never edited or deleted, only superseded by a newer entry appended after them.

It stops and asks — rather than guessing — when it's told "all" but no `repo-map.md` exists yet to seed the scope from, or when a shared-engine consumer's `OBJECT_SHORTNAME` can't be resolved from its config (marked `shortname-unresolved` rather than guessed).

Known gotcha it deliberately guards against: `srv.on('CREATE', 'SomeEntity', ...)` is an ordinary CAP request hook, not a queue-event subscription — the sweeper only treats a grepped `srv.on(` call as a consumer registration when its first argument actually looks like a topic string (contains `/` or `.`), not a bare CRUD verb/entity name.

## Knowledge output

`.claude/knowledge/event-map.md` — a plain project file, not installed or managed by this plugin directly (same posture as `repo-map.md`), safe to commit or `.gitignore` per your team's preference. One block per distinct topic: producer repo/function, consumer repo(s)/handler(s), queue binding name (if discoverable from config), retry/DLQ notes, and a status that distinguishes "not checked out" from "producer-only" or "consumer-only" (a genuine structural gap, not a missing checkout).
